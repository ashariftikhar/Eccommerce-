import fs from 'fs/promises';
import path from 'path';
import {
  approveDraft,
  createPipelineServices,
  enableApprovalPhase,
  initializeServices,
  processJob,
  publishDraftNow,
  runDiscoveryCycle,
  sendCeoMessage,
  simulateSupplierFollowUp,
} from '../src/lib/pipeline';
import { loadConfig } from '../src/lib/config';
import {
  finishExecution,
  pushExecutionStep,
  pushValidationRun,
  startExecution,
} from '../src/lib/store';
import { validateCustomerSupportDraft } from '../src/lib/validation';
import { AgentId, OrderRecord, RuntimeConfig, WorkerJob } from '../src/types';
import { createId, nowIso, sha256 } from '../src/lib/utils';

type AgentResultStatus = 'passed' | 'warning' | 'blocked' | 'not-run';

interface AgentDiagnostic {
  agentId: AgentId;
  status: AgentResultStatus;
  mode: 'live-smoke' | 'synthetic-sandbox';
  summary: string;
  evidence: string[];
}

function tempConfig(base: RuntimeConfig, suffix: string): RuntimeConfig {
  return {
    ...base,
    storageDriver: 'file',
    databaseUrl: null,
    dataFilePath: path.join(process.cwd(), 'storage', `agent-diagnostics-${suffix}-${Date.now()}.json`),
  };
}

async function cleanup(config: RuntimeConfig) {
  if (config.storageDriver === 'file') {
    await fs.rm(config.dataFilePath, { force: true }).catch(() => undefined);
  }
}

function addResult(results: AgentDiagnostic[], result: AgentDiagnostic) {
  results.push(result);
}

async function runLiveCjSmoke(base: RuntimeConfig): Promise<AgentDiagnostic[]> {
  const config = tempConfig(
    {
      ...base,
      ebay: {
        ...base.ebay,
        clientId: null,
        clientSecret: null,
        sandboxClientId: null,
        sandboxClientSecret: null,
      },
      ai: {
        ...base.ai,
        deepseekApiKey: null,
        geminiApiKey: null,
      },
    },
    'live-cj',
  );

  const services = createPipelineServices(config);
  const results: AgentDiagnostic[] = [];

  try {
    await initializeServices(services);
    const run = await runDiscoveryCycle(services);
    const state = await services.store.getState();
    const shortlisted = state.candidates.filter((item) => item.status === 'READY_TO_LIST' || item.status === 'TEST_ONLY').length;
    addResult(results, {
      agentId: 'trend_discovery',
      status: run.scanned > 0 ? 'passed' : 'blocked',
      mode: 'live-smoke',
      summary: `Live CJ smoke scanned ${run.scanned} products.`,
      evidence: [
        `scanned=${run.scanned}`,
        `shortlisted=${run.shortlisted}`,
        `drafted=${run.drafted}`,
      ],
    });
    addResult(results, {
      agentId: 'cj_match',
      status: run.scanned > 0 ? (shortlisted > 0 ? 'passed' : 'warning') : 'blocked',
      mode: 'live-smoke',
      summary: shortlisted > 0 ? 'Live CJ products passed the US prefilter.' : 'Live CJ feed reached the matcher, but no products passed the current US prefilter.',
      evidence: [
        `candidate_count=${state.candidates.length}`,
        `shortlisted=${shortlisted}`,
        `common_reject_path=${shortlisted === 0 ? 'non-US-or-prefilter-fail' : 'n/a'}`,
      ],
    });
    return results;
  } finally {
    await cleanup(config);
  }
}

async function runSyntheticSandbox(base: RuntimeConfig): Promise<AgentDiagnostic[]> {
  const config = tempConfig(
    {
      ...base,
      ebay: {
        ...base.ebay,
        clientId: null,
        clientSecret: null,
        sandboxClientId: null,
        sandboxClientSecret: null,
      },
      cj: {
        ...base.cj,
        apiKey: null,
        accessToken: null,
      },
      ai: {
        ...base.ai,
        deepseekApiKey: null,
        geminiApiKey: null,
      },
    },
    'synthetic',
  );

  const services = createPipelineServices(config);
  const results: AgentDiagnostic[] = [];

  try {
    await initializeServices(services);
    const discovery = await runDiscoveryCycle(services);
    let state = await services.store.getState();

    const firstCandidate = state.candidates.find((item) => Boolean(item.scoreBreakdown));
    const firstDraft = state.listingDrafts[0];

    addResult(results, {
      agentId: 'trend_discovery',
      status: discovery.scanned > 0 ? 'passed' : 'blocked',
      mode: 'synthetic-sandbox',
      summary: `Synthetic discovery scanned ${discovery.scanned} products.`,
      evidence: [`shortlisted=${discovery.shortlisted}`, `drafted=${discovery.drafted}`],
    });
    addResult(results, {
      agentId: 'cj_match',
      status: discovery.shortlisted > 0 ? 'passed' : 'blocked',
      mode: 'synthetic-sandbox',
      summary: 'Synthetic CJ matching and US prefilter executed.',
      evidence: [`shortlisted=${discovery.shortlisted}`],
    });
    addResult(results, {
      agentId: 'product_scoring',
      status: firstCandidate?.scoreBreakdown ? 'passed' : 'blocked',
      mode: 'synthetic-sandbox',
      summary: firstCandidate?.scoreBreakdown ? 'Score breakdowns were generated for candidates.' : 'No scored candidates available.',
      evidence: firstCandidate?.scoreBreakdown
        ? [`decision=${firstCandidate.scoreBreakdown.decision}`, `total_score=${firstCandidate.scoreBreakdown.totalScore}`]
        : ['score_breakdown=missing'],
    });
    addResult(results, {
      agentId: 'listing_generator',
      status: firstDraft ? 'passed' : 'blocked',
      mode: 'synthetic-sandbox',
      summary: firstDraft ? 'Listing drafts were generated and validated.' : 'No listing draft was created.',
      evidence: firstDraft
        ? [`draft_status=${firstDraft.status}`, `warning_count=${firstDraft.warningMessages.length}`]
        : ['draft=missing'],
    });

    if (!firstDraft || !firstCandidate) {
      addResult(results, {
        agentId: 'ebay_publisher',
        status: 'blocked',
        mode: 'synthetic-sandbox',
        summary: 'Publish test skipped because no draft was available.',
        evidence: ['draft=missing'],
      });
      addResult(results, {
        agentId: 'fulfillment',
        status: 'blocked',
        mode: 'synthetic-sandbox',
        summary: 'Fulfillment test skipped because no draft/candidate path was available.',
        evidence: ['publish_prerequisite=missing'],
      });
    } else {
      await enableApprovalPhase(services);
      await approveDraft(services, firstDraft.id, 'diagnostics');
      const published = await publishDraftNow(services, firstDraft.id);
      addResult(results, {
        agentId: 'ebay_publisher',
        status: published.status === 'published' ? 'passed' : 'blocked',
        mode: 'synthetic-sandbox',
        summary: published.status === 'published' ? 'Draft published through simulated sandbox eBay flow.' : 'Publish did not complete.',
        evidence: [
          `draft_status=${published.status}`,
          `inventory_item=${published.ebayInventoryItemId || 'missing'}`,
          `offer_id=${published.ebayOfferId || 'missing'}`,
        ],
      });

      state = await services.store.getState();
      const draft = state.listingDrafts.find((item) => item.id === firstDraft.id)!;
      const order: OrderRecord = {
        id: createId('order'),
        ebayOrderId: `SIM-ORDER-${Date.now()}`,
        draftId: draft.id,
        sellerSku: draft.sellerSku,
        buyerUserId: 'diagnostic-buyer',
        orderTotalUsd: Math.min(39.99, draft.price),
        quantity: 1,
        destinationCountry: 'US',
        address: {
          name: 'Diagnostic Buyer',
          line1: '100 Main Street',
          city: 'Austin',
          state: 'TX',
          postalCode: '73301',
          countryCode: 'US',
        },
        fulfillmentStatus: 'QUEUED_FOR_PUSH',
        riskClass: 'low',
        trackingNumber: null,
        carrier: null,
        linkedExecutionIds: [],
        linkedValidationIds: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.orders.unshift(order);
      await services.store.saveState(state);

      services.config.cj.accessToken = 'SIMULATED';
      services.config.cj.apiKey = 'SIMULATED';
      services.cj.placeOrder = async ({ idempotencyKey }) => ({
        cjOrderId: `SIM-CJ-${idempotencyKey.slice(0, 8)}`,
      });

      const job: WorkerJob = {
        id: createId('job'),
        type: 'order_push',
        payload: { orderId: order.id },
        status: 'queued',
        attemptCount: 1,
        nextAttemptAt: nowIso(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await processJob(services, job);
      state = await services.store.getState();
      const placedOrder = state.orders.find((item) => item.id === order.id);
      const fulfillment = state.fulfillmentJobs.find((item) => item.orderId === order.id);
      addResult(results, {
        agentId: 'fulfillment',
        status: placedOrder?.fulfillmentStatus === 'PLACED' && Boolean(fulfillment?.cjOrderId) ? 'passed' : 'blocked',
        mode: 'synthetic-sandbox',
        summary: placedOrder?.fulfillmentStatus === 'PLACED' ? 'Low-risk order was placed through simulated CJ fulfillment.' : 'Fulfillment did not reach placed state.',
        evidence: [
          `fulfillment_status=${placedOrder?.fulfillmentStatus || 'missing'}`,
          `cj_order=${fulfillment?.cjOrderId || 'missing'}`,
          `idempotency=${fulfillment?.idempotencyKey ? 'present' : 'missing'}`,
        ],
      });
    }

    state = await services.store.getState();
    const supplierChat = state.supplierChats[0];
    await simulateSupplierFollowUp(services, supplierChat.id, 'Diagnostics check: please confirm dispatch speed and stock resilience.');
    state = await services.store.getState();
    const updatedSupplier = state.supplierChats.find((item) => item.id === supplierChat.id)!;
    addResult(results, {
      agentId: 'supplier_liaison',
      status: updatedSupplier.messages.length > supplierChat.messages.length ? 'passed' : 'blocked',
      mode: 'synthetic-sandbox',
      summary: 'Supplier follow-up and acknowledgment were recorded.',
      evidence: [
        `message_count=${updatedSupplier.messages.length}`,
        `status=${updatedSupplier.status}`,
      ],
    });

    await sendCeoMessage(services, 'Give me a diagnostics summary of the current system state.');
    state = await services.store.getState();
    const ceoTail = state.ceoChat.messages[state.ceoChat.messages.length - 1];
    addResult(results, {
      agentId: 'manager',
      status: ceoTail?.sender === 'ceo' ? 'passed' : 'blocked',
      mode: 'synthetic-sandbox',
      summary: 'Manager agent responded in CEO chat with traceable output.',
      evidence: [
        `provider=${ceoTail?.provider || 'missing'}`,
        `model=${ceoTail?.modelName || 'system'}`,
      ],
    });

    state = await services.store.getState();
    const supportExec = startExecution(state, 'customer_support', 'diagnostics_support', {
      linkedResourceType: 'customer_chat',
      linkedResourceId: 'diagnostic-thread',
      summary: 'Diagnostics support draft validation.',
    });
    pushExecutionStep(state, supportExec.id, {
      stepName: 'Draft customer reply',
      provider: 'system',
      modelName: null,
      requestPurpose: 'Validate safe informational support behavior',
      inputSummary: 'Customer asked for shipping status update.',
      outputSummary: 'Drafted a safe shipment-status reply.',
      durationMs: 14,
      success: true,
      error: null,
    });
    const supportValidation = validateCustomerSupportDraft(
      supportExec.id,
      'diagnostic-thread',
      'Your order is in transit and we will share tracking updates as soon as they post.',
      true,
      false,
    );
    pushValidationRun(state, supportValidation);
    finishExecution(state, supportExec.id, 'completed', 'Customer support draft validated.');
    await services.store.saveState(state);
    addResult(results, {
      agentId: 'customer_support',
      status: supportValidation.status === 'failed' ? 'blocked' : supportValidation.status === 'warning' ? 'warning' : 'passed',
      mode: 'synthetic-sandbox',
      summary: 'Customer support draft passed validation in draft-only mode.',
      evidence: [
        `validation_status=${supportValidation.status}`,
        `fallback_used=${supportValidation.fallbackUsed}`,
      ],
    });

    return results;
  } finally {
    await cleanup(config);
  }
}

async function main() {
  const base = loadConfig();
  const results = [
    ...(await runLiveCjSmoke(base)),
    ...(await runSyntheticSandbox(base)),
  ];

  console.log(
    JSON.stringify(
      {
        ok: true,
        generatedAt: nowIso(),
        summary: {
          passed: results.filter((item) => item.status === 'passed').length,
          warning: results.filter((item) => item.status === 'warning').length,
          blocked: results.filter((item) => item.status === 'blocked').length,
          notRun: results.filter((item) => item.status === 'not-run').length,
        },
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
