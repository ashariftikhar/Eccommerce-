import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ArchitecturePayload,
  AgentExecution,
  AgentId,
  AgentStatusCard,
  AppState,
  AgentsPayload,
  CeoChatPayload,
  CustomerChatsPayload,
  DashboardPayload,
  InventoryPayload,
  OrdersPayload,
  OverviewPayload,
  StoreOverview,
  StorePayload,
  SupplierChatsPayload,
  ValidationPayload,
} from './src/types';
import { loadConfig } from './src/lib/config';
import {
  activateKillSwitch,
  approveDraft,
  createPipelineServices,
  enableApprovalPhase,
  initializeServices,
  nextRetryIso,
  processJob,
  recordDeadLetter,
  rejectDraft,
  rerunValidationForExecution,
  refineValidationForExecution,
  resumeAutomation,
  runDiscoveryCycle,
  sendCeoMessage,
  simulateSupplierFollowUp,
} from './src/lib/pipeline';
import { createStoreAdapter } from './src/lib/store';
import { architectureFailureMatrix, architectureFlowchart, architectureRoutingRules, getAgentContract, summarizeValidationRuns } from './src/lib/validation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getState(): Promise<AppState> {
  const config = loadConfig();
  const store = createStoreAdapter(config);
  return store.getState();
}

function buildAgentFleet(state: AppState): AgentStatusCard[] {
  const now = new Date().toISOString();
  const draftsWaiting = state.listingDrafts.filter((draft) => draft.status === 'DRAFT_READY').length;
  const publishing = state.listingDrafts.filter((draft) => draft.status === 'APPROVED' || draft.status === 'PUBLISHING').length;
  const blockedCandidates = state.candidates.filter((candidate) => candidate.status === 'BLOCKED').length;
  const lowRiskOrders = state.orders.filter((order) => order.fulfillmentStatus === 'QUEUED_FOR_PUSH').length;
  const supplierIssues = state.supplierChats.filter((chat) => chat.status === 'issue' || chat.status === 'awaiting_reply').length;
  const openSupport = state.supportThreads.filter((thread) => thread.state !== 'resolved').length;
  const paused = state.settings.automationMode === 'PAUSED';
  const executionsByAgent = new Map<AgentId, AgentExecution[]>();
  for (const execution of state.agentExecutions) {
    const bucket = executionsByAgent.get(execution.agentId) || [];
    bucket.push(execution);
    executionsByAgent.set(execution.agentId, bucket);
  }

  return state.agentDefinitions.map((definition) => {
    const executions = executionsByAgent.get(definition.id) || [];
    const completed = executions.filter((execution) => execution.status === 'completed').length;
    const failed = executions.filter((execution) => execution.status === 'failed').length;
    const successRate = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 100;
    const latest = executions[0];

    switch (definition.id) {
      case 'trend_discovery':
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Discovery',
          status: paused ? 'idle' : 'running',
          currentTask: paused ? 'Paused by kill switch' : 'Scanning CJ inventory, normalizing keywords, and forming discovery candidates.',
          queueDepth: state.candidates.length,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || state.settings.lastDiscoveryRunAt || now,
        };
      case 'cj_match':
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Supplier Match',
          status: paused ? 'idle' : supplierIssues > 0 ? 'watching' : 'running',
          currentTask: supplierIssues > 0 ? `${supplierIssues} supplier threads are waiting on replies or issue resolution.` : 'Validating US-warehouse stock, cost, ETA, and supplier readiness.',
          queueDepth: state.candidates.filter((candidate) => candidate.warehouseCountry === 'US').length,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || state.settings.lastDiscoveryRunAt || now,
        };
      case 'product_scoring':
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Scoring',
          status: paused ? 'idle' : blockedCandidates > 0 ? 'watching' : 'running',
          currentTask: blockedCandidates > 0 ? `${blockedCandidates} candidates are blocked or under policy review.` : 'Combining demand, margin, competition, and risk signals.',
          queueDepth: state.candidates.filter((candidate) => candidate.status === 'DISCOVERED').length,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || state.settings.lastDiscoveryRunAt || now,
        };
      case 'listing_generator':
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Drafting',
          status: draftsWaiting > 0 ? 'running' : paused ? 'idle' : 'watching',
          currentTask: draftsWaiting > 0 ? `${draftsWaiting} drafts are ready for review with provider-aware traces.` : 'Waiting for score-qualified products to generate listing packs.',
          queueDepth: draftsWaiting,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || state.settings.lastDiscoveryRunAt || now,
        };
      case 'ebay_publisher':
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Publish',
          status: paused ? 'blocked' : publishing > 0 ? 'running' : 'idle',
          currentTask: paused ? 'Publishing is disabled until resume.' : publishing > 0 ? `Publishing or syncing ${publishing} draft(s).` : 'No approved drafts are queued right now.',
          queueDepth: publishing,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || now,
        };
      case 'fulfillment':
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Fulfillment',
          status: paused ? 'blocked' : lowRiskOrders > 0 ? 'running' : 'idle',
          currentTask: lowRiskOrders > 0 ? `Evaluating ${lowRiskOrders} order(s) for low-risk CJ auto-push.` : 'No low-risk orders are waiting right now.',
          queueDepth: lowRiskOrders,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || state.settings.lastOrderSyncAt || now,
        };
      case 'customer_support':
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Support',
          status: openSupport > 0 ? 'watching' : paused ? 'idle' : 'running',
          currentTask: openSupport > 0 ? `${openSupport} support thread(s) need follow-up or escalation.` : 'Watching for customer issues and message sentiment.',
          queueDepth: openSupport,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || now,
        };
      case 'supplier_liaison':
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Supplier Ops',
          status: supplierIssues > 0 ? 'watching' : 'running',
          currentTask: supplierIssues > 0 ? `${supplierIssues} supplier conversation(s) need a follow-up.` : 'Monitoring supplier SLAs, stock commitments, and issue resolution.',
          queueDepth: supplierIssues,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || now,
        };
      default:
        return {
          id: definition.id,
          name: definition.name,
          role: definition.purpose,
          stage: 'Control',
          status: paused ? 'blocked' : 'running',
          currentTask: paused ? 'Kill switch active. Monitoring only.' : 'Watching budget, alerts, and state transitions across the system.',
          queueDepth: state.alerts.filter((alert) => alert.status === 'open').length,
          successRate,
          lastHeartbeatAt: latest?.finishedAt || now,
        };
    }
  });
}

function buildStoreOverview(state: AppState): StoreOverview[] {
  const today = new Date().toISOString().slice(0, 10);
  const ordersToday = state.orders.filter((order) => order.createdAt.slice(0, 10) === today);
  const grossRevenueUsd = ordersToday.reduce((sum, order) => sum + order.orderTotalUsd, 0);
  const publishedListings = state.listingDrafts.filter((draft) => draft.status === 'PUBLISHED').length;
  const pendingApprovals = state.listingDrafts.filter((draft) => draft.status === 'DRAFT_READY').length;
  const criticalAlerts = state.alerts.filter((alert) => alert.status === 'open' && alert.severity === 'critical').length;
  const riskState = state.settings.automationMode === 'PAUSED' || criticalAlerts > 0 ? 'risk' : pendingApprovals > 0 ? 'watch' : 'healthy';
  const ebayConnection = state.connections.find((connection) => connection.name === 'eBay');
  const cjConnection = state.connections.find((connection) => connection.name === 'CJdropshipping');

  return [
    {
      id: 'store-ebay',
      name: 'YuziGoods eBay US',
      platform: 'eBay US',
      status: ebayConnection?.status === 'sandbox' ? 'sandbox' : riskState === 'healthy' ? 'connected' : riskState === 'watch' ? 'watch' : 'risk',
      totalListings: state.listingDrafts.length + state.importedListings.length,
      publishedListings,
      pendingApprovals,
      ordersToday: ordersToday.length,
      grossRevenueUsd,
      accountHealth: riskState,
      note:
        ebayConnection?.status === 'sandbox'
          ? 'Sandbox behavior is active. Historical import and buyer messages will unlock after seller OAuth.'
          : pendingApprovals > 0
            ? 'Approval-first workflow is active. Review drafts before wider automation.'
            : 'Store is aligned with the current automation mode.',
    },
    {
      id: 'store-cj',
      name: 'CJ Supplier Network',
      platform: 'CJdropshipping US Warehouses',
      status: cjConnection?.status === 'connected' ? 'connected' : 'watch',
      totalListings: state.candidates.length,
      publishedListings: state.fulfillmentJobs.filter((job) => job.status === 'PLACED').length,
      pendingApprovals: state.supplierChats.filter((chat) => chat.status === 'awaiting_reply' || chat.status === 'issue').length,
      ordersToday: state.fulfillmentJobs.length,
      grossRevenueUsd,
      accountHealth: state.supplierChats.some((chat) => chat.status === 'issue') ? 'risk' : 'watch',
      note: 'Tracks supplier replies, warehouse commitments, and fast-shipping readiness for YuziGoods.',
    },
  ];
}

async function buildDashboard(): Promise<DashboardPayload> {
  const state = await getState();
  const publishedListings = state.listingDrafts.filter((draft) => draft.status === 'PUBLISHED').length;
  const pendingApprovals = state.listingDrafts.filter((draft) => draft.status === 'DRAFT_READY').length;
  const readyToList = state.candidates.filter((candidate) => candidate.status === 'READY_TO_LIST').length;
  const openAlerts = state.alerts.filter((alert) => alert.status === 'open').length;
  const autoPushEligibleOrders = state.orders.filter((order) => order.fulfillmentStatus === 'QUEUED_FOR_PUSH').length;

  return {
    generatedAt: new Date().toISOString(),
    settings: state.settings,
    budgets: state.budgets,
    connections: state.connections,
    stats: {
      totalCandidates: state.candidates.length,
      readyToList,
      pendingApprovals,
      publishedListings,
      openAlerts,
      deadLetters: state.deadLetters.length,
      autoPushEligibleOrders,
    },
    candidates: state.candidates.slice(0, 80),
    listingDrafts: state.listingDrafts.slice(0, 40),
    alerts: state.alerts.slice(0, 20),
    deadLetters: state.deadLetters.slice(0, 20),
    supportThreads: state.supportThreads.slice(0, 20),
    agentFleet: buildAgentFleet(state),
    storeOverview: buildStoreOverview(state),
    supplierChats: state.supplierChats.slice(0, 12),
    recentRuns: state.agentRuns.slice(0, 10),
    auditLogs: state.auditLogs.slice(0, 12),
  };
}

async function buildOverviewPayload(): Promise<OverviewPayload> {
  const dashboard = await buildDashboard();
  return {
    generatedAt: dashboard.generatedAt,
    settings: dashboard.settings,
    budgets: dashboard.budgets,
    connections: dashboard.connections,
    stats: dashboard.stats,
    alerts: dashboard.alerts,
    storeOverview: dashboard.storeOverview,
  };
}

async function buildAgentsPayload(): Promise<AgentsPayload> {
  const state = await getState();
  return {
    generatedAt: new Date().toISOString(),
    definitions: state.agentDefinitions,
    fleet: buildAgentFleet(state),
    executions: state.agentExecutions.slice(0, 60),
    recentRuns: state.agentRuns.slice(0, 20),
  };
}

async function buildStorePayload(): Promise<StorePayload> {
  const state = await getState();
  const ebayConnected = Boolean(loadConfig().ebay.clientId || loadConfig().ebay.sandboxClientId);
  const cjConnected = Boolean(loadConfig().cj.accessToken && loadConfig().cj.apiKey);
  return {
    generatedAt: new Date().toISOString(),
    connections: state.connections,
    storeOverview: buildStoreOverview(state),
    settings: state.settings,
    alerts: state.alerts.slice(0, 20),
    readinessChecklist: [
      {
        id: 'ebay-oauth',
        label: 'Connect eBay seller OAuth',
        done: ebayConnected,
        note: ebayConnected ? 'eBay app credentials detected.' : 'Needed to import listings, orders, and customer messages.',
      },
      {
        id: 'cj-live',
        label: 'Enable real CJ catalog and order access',
        done: cjConnected,
        note: cjConnected ? 'Real CJ discovery is active.' : 'Synthetic CJ fallback is active until access token is configured.',
      },
      {
        id: 'sandbox-week',
        label: 'Complete 7-day sandbox observation window',
        done: false,
        note: `Sandbox started ${new Date(state.settings.sandboxStartedAt).toLocaleDateString()} and ends ${new Date(state.settings.sandboxEndsAt).toLocaleDateString()}.`,
      },
      {
        id: 'approval-phase',
        label: 'Stay in approval-required mode for first production phase',
        done: state.settings.automationMode === 'APPROVAL_REQUIRED' || state.settings.automationMode === 'AUTO_PUBLISH',
        note: 'Keep listing approval on until the account and supplier loop are stable.',
      },
    ],
  };
}

async function buildInventoryPayload(): Promise<InventoryPayload> {
  const state = await getState();
  return {
    generatedAt: new Date().toISOString(),
    candidates: state.candidates,
    drafts: state.listingDrafts.filter((draft) => draft.status !== 'PUBLISHED'),
    published: state.listingDrafts.filter((draft) => draft.status === 'PUBLISHED'),
    blocked: state.candidates.filter((candidate) => candidate.status === 'BLOCKED'),
    importedListings: state.importedListings,
  };
}

async function buildOrdersPayload(): Promise<OrdersPayload> {
  const state = await getState();
  return {
    generatedAt: new Date().toISOString(),
    orders: state.orders,
    fulfillmentJobs: state.fulfillmentJobs,
    importedOrders: state.importedOrders,
  };
}

async function buildSupplierChatsPayload(): Promise<SupplierChatsPayload> {
  const state = await getState();
  return {
    generatedAt: new Date().toISOString(),
    chats: state.supplierChats,
  };
}

async function buildCustomerChatsPayload(): Promise<CustomerChatsPayload> {
  const state = await getState();
  const ebayConnected = Boolean(loadConfig().ebay.clientId || loadConfig().ebay.sandboxClientId);
  return {
    generatedAt: new Date().toISOString(),
    connected: ebayConnected,
    importScopeDays: 90,
    waitingReason: ebayConnected ? null : 'Customer chats stay read-only until eBay seller OAuth is connected. The console will import the last 90 days once credentials are added.',
    conversations: state.customerChats,
  };
}

async function buildCeoChatPayload(): Promise<CeoChatPayload> {
  const state = await getState();
  return {
    generatedAt: new Date().toISOString(),
    thread: state.ceoChat,
  };
}

async function buildArchitecturePayload(): Promise<ArchitecturePayload> {
  const state = await getState();
  return {
    generatedAt: new Date().toISOString(),
    flowchart: architectureFlowchart(),
    contracts: state.agentContracts,
    routingRules: architectureRoutingRules(),
    failureMatrix: architectureFailureMatrix(),
    validationSummary: summarizeValidationRuns(state),
  };
}

async function buildValidationPayload(): Promise<ValidationPayload> {
  const state = await getState();
  return {
    generatedAt: new Date().toISOString(),
    stats: {
      passed: state.validationRuns.filter((run) => run.status === 'passed').length,
      warnings: state.validationRuns.filter((run) => run.status === 'warning').length,
      failed: state.validationRuns.filter((run) => run.status === 'failed').length,
      fallbackRuns: state.validationRuns.filter((run) => run.fallbackUsed).length,
      simulatedRuns: state.validationRuns.filter((run) => run.simulatedData).length,
    },
    runs: state.validationRuns.slice(0, 120),
  };
}

async function runWorkerTick() {
  const config = loadConfig();
  const services = createPipelineServices(config);
  await initializeServices(services);
  const jobs = await services.store.claimJobs(5, 'web-manual-tick');

  for (const job of jobs) {
    try {
      await processJob(services, job);
      await services.store.completeJob(job.id);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown worker failure');
      if (job.attemptCount >= 3) {
        await services.store.failJob(job.id, err.message);
        await recordDeadLetter(services, job, err);
      } else {
        await services.store.retryJob(job.id, err.message, nextRetryIso(job.attemptCount));
      }
    }
  }

  return jobs.length;
}

async function startServer() {
  const config = loadConfig();
  const services = createPipelineServices(config);
  await initializeServices(services);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/debug/env', (_req, res) => {
    const cfg = loadConfig();
    res.json({
      NODE_ENV: process.env.NODE_ENV,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? `${process.env.DEEPSEEK_API_KEY.substring(0, 5)}...${process.env.DEEPSEEK_API_KEY.substring(process.env.DEEPSEEK_API_KEY.length - 5)}` : 'NOT SET',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.substring(0, 5)}...${process.env.GEMINI_API_KEY.substring(process.env.GEMINI_API_KEY.length - 5)}` : 'NOT SET',
      CJ_API_KEY: process.env.CJ_API_KEY ? `${process.env.CJ_API_KEY.substring(0, 5)}...${process.env.CJ_API_KEY.substring(process.env.CJ_API_KEY.length - 5)}` : 'NOT SET',
      config_deepseek: cfg.ai.deepseekApiKey ? 'LOADED' : 'NOT LOADED',
      config_gemini: cfg.ai.geminiApiKey ? 'LOADED' : 'NOT LOADED',
      config_cj_token: cfg.cj.accessToken ? 'LOADED' : 'NOT LOADED',
    });
  });

  app.get('/api/dashboard', async (_req, res) => {
    res.json(await buildDashboard());
  });
  app.get('/api/overview', async (_req, res) => {
    res.json(await buildOverviewPayload());
  });
  app.get('/api/agents', async (_req, res) => {
    res.json(await buildAgentsPayload());
  });
  app.get('/api/agents/:agentId/executions', async (req, res) => {
    const state = await getState();
    res.json({
      generatedAt: new Date().toISOString(),
      executions: state.agentExecutions.filter((execution) => execution.agentId === req.params.agentId).slice(0, 40),
    });
  });
  app.get('/api/store', async (_req, res) => {
    res.json(await buildStorePayload());
  });
  app.get('/api/inventory', async (_req, res) => {
    res.json(await buildInventoryPayload());
  });
  app.get('/api/orders', async (_req, res) => {
    res.json(await buildOrdersPayload());
  });
  app.get('/api/suppliers/chats', async (_req, res) => {
    res.json(await buildSupplierChatsPayload());
  });
  app.get('/api/customer-chats', async (_req, res) => {
    res.json(await buildCustomerChatsPayload());
  });
  app.get('/api/ceo-chat', async (_req, res) => {
    res.json(await buildCeoChatPayload());
  });
  app.get('/api/architecture', async (_req, res) => {
    res.json(await buildArchitecturePayload());
  });
  app.get('/api/validation', async (_req, res) => {
    res.json(await buildValidationPayload());
  });
  app.get('/api/validation/:executionId', async (req, res) => {
    const state = await getState();
    res.json({
      generatedAt: new Date().toISOString(),
      runs: state.validationRuns.filter((run) => run.executionId === req.params.executionId),
    });
  });
  app.get('/api/agents/:agentId/contract', async (req, res) => {
    const state = await getState();
    res.json({
      generatedAt: new Date().toISOString(),
      contract: getAgentContract(state, req.params.agentId as AgentId),
    });
  });

  app.post('/api/discovery/run', async (_req, res) => {
    const summary = await runDiscoveryCycle(services);
    res.json({ success: true, summary });
  });

  app.post('/api/drafts/:draftId/approve', async (req, res) => {
    const draft = await approveDraft(services, req.params.draftId, 'owner');
    res.json({ success: true, draft });
  });

  app.post('/api/drafts/:draftId/reject', async (req, res) => {
    const draft = await rejectDraft(services, req.params.draftId, 'owner');
    res.json({ success: true, draft });
  });

  app.post('/api/drafts/:draftId/publish', async (req, res) => {
    const store = createStoreAdapter(config);
    const state = await store.getState();
    state.settings.publishingEnabled = true;
    const draft = state.listingDrafts.find((item) => item.id === req.params.draftId);
    if (draft && draft.status !== 'PUBLISHED') {
      draft.status = 'APPROVED';
      draft.updatedAt = new Date().toISOString();
      await store.enqueueJob('publish_listing', { draftId: draft.id });
    }
    await store.saveState(state);
    const processed = await runWorkerTick();
    res.json({ success: true, processedJobs: processed });
  });

  app.post('/api/suppliers/chats/:chatId/simulate-send', async (req, res) => {
    const message = typeof req.body?.message === 'string' && req.body.message.trim() ? req.body.message.trim() : 'Please confirm the latest stock and dispatch timing for this SKU.';
    await simulateSupplierFollowUp(services, req.params.chatId, message);
    res.json({ success: true });
  });

  app.post('/api/ceo-chat/messages', async (req, res) => {
    const message = typeof req.body?.message === 'string' && req.body.message.trim() ? req.body.message.trim() : 'Give me the current state of the operation.';
    await sendCeoMessage(services, message);
    res.json({ success: true });
  });
  app.post('/api/validation/:executionId/rerun', async (req, res) => {
    await rerunValidationForExecution(services, req.params.executionId);
    res.json({ success: true });
  });
  app.post('/api/validation/:executionId/refine', async (req, res) => {
    await refineValidationForExecution(services, req.params.executionId);
    res.json({ success: true });
  });

  app.post('/api/system/mode/approval', async (_req, res) => {
    await enableApprovalPhase(services);
    res.json({ success: true });
  });

  app.post('/api/system/kill-switch', async (_req, res) => {
    await activateKillSwitch(services);
    const processed = await runWorkerTick();
    res.json({ success: true, processedJobs: processed });
  });

  app.post('/api/system/resume', async (_req, res) => {
    await resumeAutomation(services);
    res.json({ success: true });
  });

  app.post('/api/worker/tick', async (_req, res) => {
    const processed = await runWorkerTick();
    res.json({ success: true, processedJobs: processed });
  });

  if (config.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`YuziGoods Ops Console listening on ${config.appBaseUrl}`);
  });
}

startServer().catch((error) => {
  console.error('Fatal startup error', error);
  process.exit(1);
});
