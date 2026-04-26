import {
  AppState,
  DeadLetter,
  FulfillmentJob,
  ListingDraft,
  OrderRecord,
  ProductCandidate,
  RuntimeConfig,
  WorkerJob,
  ConversationMessage,
} from '../types';
import { evaluatePolicy } from './policy';
import { AIClient, CJClient, EbayClient } from './providers';
import { scoreCandidate } from './scoring';
import {
  appendCeoMessage,
  appendSupplierMessage,
  createStoreAdapter,
  finishExecution,
  pushAudit,
  pushExecutionStep,
  pushRun,
  pushValidationRun,
  startExecution,
  StoreAdapter,
} from './store';
import { clamp, createId, isMilitaryAddress, isPoBox, normalizeKeyword, nowIso, sha256, shortHash, withJitter } from './utils';
import {
  findLatestValidationForExecution,
  validateCjMatch,
  validateFulfillment,
  validateListingGenerator,
  validateManager,
  validateProductScoring,
  validatePublish,
  validateSupplierLiaison,
  validateTrendDiscovery,
} from './validation';

export interface PipelineServices {
  config: RuntimeConfig;
  store: StoreAdapter;
  cj: CJClient;
  ebay: EbayClient;
  ai: AIClient;
}

export function createPipelineServices(config: RuntimeConfig): PipelineServices {
  return {
    config,
    store: createStoreAdapter(config),
    cj: new CJClient(config),
    ebay: new EbayClient(config),
    ai: new AIClient(config),
  };
}

export async function initializeServices(services: PipelineServices): Promise<void> {
  await services.store.initialize();
}

function addExecutionLink(target: { linkedExecutionIds?: string[] }, executionId: string): void {
  if (!target.linkedExecutionIds) {
    target.linkedExecutionIds = [];
  }
  if (!target.linkedExecutionIds.includes(executionId)) {
    target.linkedExecutionIds.push(executionId);
  }
}

function prefilterProduct(product: ProductCandidate | ReturnType<typeof convertProduct>, state: AppState): string[] {
  const normalized = normalizeKeyword(`${product.title} ${product.tags.join(' ')}`);
  const blockedKeywords = state.prohibitedRules
    .filter((rule) => rule.severity === 'block')
    .map((rule) => normalizeKeyword(rule.keyword))
    .filter((keyword) => normalized.includes(keyword));

  const reasons: string[] = [];
  if (product.warehouseCountry !== 'US') {
    reasons.push('US warehouse only.');
  }
  if (product.targetPrice < 12 || product.targetPrice > 25) {
    reasons.push('Selling target outside $12-$25 band.');
  }
  if (product.landedCost > 10) {
    reasons.push('Estimated landed cost is above $10.');
  }
  if (product.stock <= 20) {
    reasons.push('Stock is at or below 20 units.');
  }
  if (product.estimatedDeliveryBusinessDays > 5) {
    reasons.push('Delivery estimate above 5 business days.');
  }
  if (blockedKeywords.length) {
    reasons.push(`Blocked keywords found: ${blockedKeywords.join(', ')}.`);
  }
  return reasons;
}

function convertProduct(product: Awaited<ReturnType<CJClient['fetchCatalog']>>[number]): ProductCandidate {
  const targetPrice = product.landedCost <= 6 ? 17.99 : product.landedCost <= 8 ? 19.99 : 22.99;
  const fingerprint = sha256(`${product.id}:${product.variantId}:${normalizeKeyword(product.title)}`);
  return {
    id: createId('candidate'),
    sourceFingerprint: fingerprint,
    sellerSku: `YZG-${shortHash(fingerprint)}`,
    cjProductId: product.id,
    cjVariantId: product.variantId,
    title: product.title,
    normalizedKeyword: product.normalizedKeyword,
    categoryPath: product.categoryPath,
    warehouseCountry: product.warehouseCountry,
    landedCost: product.landedCost,
    shippingCost: product.shippingCost,
    stock: product.stock,
    estimatedDeliveryBusinessDays: product.estimatedDeliveryBusinessDays,
    supplierName: product.supplierName,
    imageUrl: product.imageUrl,
    tags: product.tags,
    targetPrice,
    status: 'DISCOVERED',
    policyState: 'clear',
    riskClass: 'medium',
    marketplace: 'EBAY_US',
    managedBySystem: true,
    searchSnapshot: null,
    scoreBreakdown: null,
    policyMatches: [],
    linkedExecutionIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function riskClassForCandidate(candidate: ProductCandidate): ProductCandidate['riskClass'] {
  if (!candidate.scoreBreakdown) {
    return 'high';
  }
  if (candidate.scoreBreakdown.totalScore >= 85 && candidate.scoreBreakdown.returnRiskScore >= 70) {
    return 'low';
  }
  if (candidate.scoreBreakdown.totalScore >= 70) {
    return 'medium';
  }
  return 'high';
}

export async function runDiscoveryCycle(services: PipelineServices): Promise<{ scanned: number; shortlisted: number; drafted: number }> {
  const state = await services.store.getState();
  const cjIsReal = Boolean(services.config.cj.accessToken && services.config.cj.apiKey);
  const ebayIsReal = Boolean(services.config.ebay.clientId || services.config.ebay.sandboxClientId);

  const discoveryExec = startExecution(state, 'trend_discovery', 'manual_discovery', {
    summary: 'Starting CJ catalog scan and keyword normalization.',
  });
  const cjExec = startExecution(state, 'cj_match', 'manual_discovery', {
    summary: 'Prefiltering CJ products for US warehouse eligibility.',
  });
  const scoringExec = startExecution(state, 'product_scoring', 'manual_discovery', {
    summary: 'Computing market demand, competition, margin, and policy scores.',
  });
  const listingExec = startExecution(state, 'listing_generator', 'manual_discovery', {
    summary: 'Generating listing drafts for approved and test candidates.',
  });

  const catalog = await services.cj.fetchCatalog(services.config.cj.scanLimit);
  pushExecutionStep(state, discoveryExec.id, {
    stepName: 'Fetch CJ catalog',
    provider: 'cj',
    modelName: null,
    requestPurpose: 'Pull candidate catalog records',
    inputSummary: `Requested up to ${services.config.cj.scanLimit} CJ products.`,
    outputSummary: `${catalog.length} products returned from ${cjIsReal ? 'real CJ data' : 'synthetic CJ fallback data'}.`,
    durationMs: 220,
    success: true,
    error: null,
  });

  const converted = catalog.map(convertProduct);
  pushValidationRun(state, validateTrendDiscovery(discoveryExec.id, catalog.length, 0, !cjIsReal));
  const shortlistWithReasons = converted.map((candidate) => ({
    candidate,
    reasons: prefilterProduct(candidate, state),
  }));
  const shortlisted = shortlistWithReasons.filter((item) => item.reasons.length === 0).slice(0, 80).map((item) => item.candidate);
  pushExecutionStep(state, cjExec.id, {
    stepName: 'Apply CJ prefilter',
    provider: 'system',
    modelName: null,
    requestPurpose: 'Reject non-US, low-stock, slow-shipping, or blocked products before eBay calls',
    inputSummary: `${converted.length} candidate records entered the CJ prefilter.`,
    outputSummary: `${shortlisted.length} products survived the prefilter. Rejected ${converted.length - shortlisted.length} before market scoring.`,
    durationMs: 95,
    success: true,
    error: null,
  });

  let drafted = 0;
  for (const [index, candidate] of shortlisted.entries()) {
    const policy = evaluatePolicy(
      {
        id: candidate.cjProductId,
        variantId: candidate.cjVariantId,
        title: candidate.title,
        normalizedKeyword: candidate.normalizedKeyword,
        categoryPath: candidate.categoryPath,
        warehouseCountry: candidate.warehouseCountry,
        landedCost: candidate.landedCost,
        shippingCost: candidate.shippingCost,
        stock: candidate.stock,
        estimatedDeliveryBusinessDays: candidate.estimatedDeliveryBusinessDays,
        supplierName: candidate.supplierName,
        supplierAgeDays: 180,
        shippingConsistency: 85,
        stockStability: 84,
        orderHistoryScore: 82,
        imageUrl: candidate.imageUrl,
        tags: candidate.tags,
      },
      state.prohibitedRules,
      state.veroBlocklist,
    );
    const snapshot = await services.ebay.getMarketSnapshot(candidate.normalizedKeyword);
    const breakdown = scoreCandidate({
      product: {
        id: candidate.cjProductId,
        variantId: candidate.cjVariantId,
        title: candidate.title,
        normalizedKeyword: candidate.normalizedKeyword,
        categoryPath: candidate.categoryPath,
        warehouseCountry: candidate.warehouseCountry,
        landedCost: candidate.landedCost,
        shippingCost: candidate.shippingCost,
        stock: candidate.stock,
        estimatedDeliveryBusinessDays: candidate.estimatedDeliveryBusinessDays,
        supplierName: candidate.supplierName,
        supplierAgeDays: 180,
        shippingConsistency: 85,
        stockStability: 84,
        orderHistoryScore: 82,
        imageUrl: candidate.imageUrl,
        tags: candidate.tags,
      },
      snapshot,
      policyState: policy.state,
    });

    candidate.searchSnapshot = snapshot;
    candidate.policyState = policy.state;
    candidate.policyMatches = policy.matches;
    candidate.scoreBreakdown = breakdown;
    candidate.status = breakdown.decision;
    candidate.targetPrice = breakdown.targetPrice;
    candidate.riskClass = riskClassForCandidate(candidate);
    candidate.updatedAt = nowIso();

    addExecutionLink(candidate, discoveryExec.id);
    addExecutionLink(candidate, cjExec.id);
    addExecutionLink(candidate, scoringExec.id);

    const existing = state.candidates.find((item) => item.sourceFingerprint === candidate.sourceFingerprint);
    const resolvedCandidate = existing ? Object.assign(existing, candidate, { id: existing.id, createdAt: existing.createdAt }) : candidate;
    if (!existing) {
      state.candidates.unshift(resolvedCandidate);
    }
    pushValidationRun(state, validateCjMatch(cjExec.id, resolvedCandidate, !cjIsReal));
    pushValidationRun(state, validateProductScoring(scoringExec.id, resolvedCandidate, !ebayIsReal));

    if (index < 8) {
      pushExecutionStep(state, scoringExec.id, {
        stepName: `Score candidate ${index + 1}`,
        provider: ebayIsReal ? 'ebay' : 'system',
        modelName: null,
        requestPurpose: 'Combine market signals with policy and margin checks',
        inputSummary: `${candidate.title} / keyword "${candidate.normalizedKeyword}"`,
        outputSummary: `${ebayIsReal ? 'Real eBay market snapshot' : 'Simulated market snapshot'} produced total score ${breakdown.totalScore} and decision ${breakdown.decision}.`,
        durationMs: 180,
        success: true,
        error: null,
      });
    }

    if ((candidate.status === 'READY_TO_LIST' || candidate.status === 'TEST_ONLY') && !state.listingDrafts.some((draft) => draft.candidateId === resolvedCandidate.id)) {
      const generated = await services.ai.generateListingPack(state, candidate.sourceFingerprint, candidate);
      const categoryPolicies = await services.ebay.validateCategoryPolicies(candidate);
      const draft: ListingDraft = {
        id: createId('draft'),
        candidateId: resolvedCandidate.id,
        marketplace: 'EBAY_US',
        sellerSku: candidate.sellerSku,
        title: generated.pack.title,
        subtitle: generated.pack.subtitle,
        description: generated.pack.description,
        bullets: generated.pack.bullets,
        itemSpecifics: generated.pack.itemSpecifics,
        images: generated.pack.images,
        price: candidate.targetPrice,
        quantity: clamp(candidate.stock, 1, 25),
        warningMessages: [...candidate.policyMatches, ...categoryPolicies.warnings],
        status: 'DRAFT_READY',
        approvalRequired: state.settings.automationMode !== 'AUTO_PUBLISH',
        publishedAt: null,
        ebayInventoryItemId: null,
        ebayOfferId: null,
        offerCategoryId: categoryPolicies.categoryId,
        linkedExecutionIds: [listingExec.id],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      if (categoryPolicies.valid) {
        state.listingDrafts.unshift(draft);
        drafted += 1;
        pushValidationRun(
          state,
          validateListingGenerator(listingExec.id, draft, {
            fallbackUsed: generated.fallback,
            simulatedPolicy: !ebayIsReal,
            categoryWarnings: categoryPolicies.warnings,
          }),
        );
        pushExecutionStep(state, listingExec.id, {
          stepName: `Generate draft ${drafted}`,
          provider: generated.provider,
          modelName: generated.modelName,
          requestPurpose: 'Create a listing pack and policy-checked draft',
          inputSummary: `${candidate.title} / ${generated.cacheHit ? 'cache hit' : 'fresh generation'}`,
          outputSummary: `${generated.fallback ? 'Template fallback' : 'AI-generated listing content'} created draft ${draft.sellerSku}. ${ebayIsReal ? 'Real eBay metadata validation' : 'Simulated eBay policy validation'} completed.`,
          durationMs: 260,
          success: true,
          error: null,
        });
      }
    }
  }

  state.settings.lastDiscoveryRunAt = nowIso();
  const discoveryValidation = state.validationRuns.find((run) => run.executionId === discoveryExec.id && run.agentId === 'trend_discovery');
  if (discoveryValidation) {
    discoveryValidation.validatorResults = validateTrendDiscovery(discoveryExec.id, catalog.length, shortlisted.length, !cjIsReal).validatorResults;
    discoveryValidation.status = validateTrendDiscovery(discoveryExec.id, catalog.length, shortlisted.length, !cjIsReal).status;
    discoveryValidation.blocking = validateTrendDiscovery(discoveryExec.id, catalog.length, shortlisted.length, !cjIsReal).blocking;
    discoveryValidation.score = validateTrendDiscovery(discoveryExec.id, catalog.length, shortlisted.length, !cjIsReal).score;
    discoveryValidation.updatedAt = nowIso();
  }
  finishExecution(state, discoveryExec.id, 'completed', `Scanned ${catalog.length} catalog items and normalized discovery input.`);
  finishExecution(state, cjExec.id, 'completed', `${shortlisted.length} CJ products passed prefilter and moved to scoring.`);
  finishExecution(state, scoringExec.id, 'completed', `${shortlisted.length} candidates were scored using ${ebayIsReal ? 'real' : 'simulated'} eBay market data.`);
  finishExecution(state, listingExec.id, 'completed', `${drafted} listing drafts created with provider-aware content generation.`);
  pushRun(state, 'discovery', 'completed', `Scanned ${catalog.length} CJ products, shortlisted ${shortlisted.length}, drafted ${drafted}.`);
  pushAudit(state, 'discovery.run', `Discovery cycle completed with ${drafted} drafts created.`);
  await services.store.saveState(state);
  return { scanned: catalog.length, shortlisted: shortlisted.length, drafted };
}

export async function approveDraft(services: PipelineServices, draftId: string, actor = 'owner'): Promise<ListingDraft> {
  const state = await services.store.getState();
  const draft = state.listingDrafts.find((item) => item.id === draftId);
  if (!draft) {
    throw new Error('Draft not found.');
  }
  if (draft.status === 'PUBLISHED' || draft.status === 'APPROVED' || draft.status === 'PUBLISHING') {
    return draft;
  }

  const exec = startExecution(state, 'manager', 'owner_approval', {
    linkedResourceType: 'draft',
    linkedResourceId: draft.id,
    summary: `Owner approval requested for ${draft.sellerSku}.`,
  });
  pushExecutionStep(state, exec.id, {
    stepName: 'Approve draft',
    provider: 'system',
    modelName: null,
    requestPurpose: 'Move draft into the publish queue',
    inputSummary: `Draft ${draft.sellerSku} in status ${draft.status}.`,
    outputSummary: `Draft ${draft.sellerSku} marked APPROVED and publish job queued.`,
    durationMs: 25,
    success: true,
    error: null,
  });

  draft.status = 'APPROVED';
  draft.updatedAt = nowIso();
  addExecutionLink(draft, exec.id);
  finishExecution(state, exec.id, 'completed', `Draft ${draft.sellerSku} approved.`);
  pushAudit(state, 'listing.approved', `Draft ${draft.sellerSku} approved for publish queue.`, actor);
  await services.store.enqueueJob('publish_listing', { draftId });
  await services.store.saveState(state);
  return draft;
}

export async function rejectDraft(services: PipelineServices, draftId: string, actor = 'owner'): Promise<ListingDraft> {
  const state = await services.store.getState();
  const draft = state.listingDrafts.find((item) => item.id === draftId);
  if (!draft) {
    throw new Error('Draft not found.');
  }

  const exec = startExecution(state, 'manager', 'owner_reject', {
    linkedResourceType: 'draft',
    linkedResourceId: draft.id,
    summary: `Owner rejected draft ${draft.sellerSku}.`,
  });
  pushExecutionStep(state, exec.id, {
    stepName: 'Reject draft',
    provider: 'system',
    modelName: null,
    requestPurpose: 'Remove draft from the approval queue',
    inputSummary: `Draft ${draft.sellerSku} in status ${draft.status}.`,
    outputSummary: `Draft ${draft.sellerSku} moved to REJECTED.`,
    durationMs: 20,
    success: true,
    error: null,
  });

  draft.status = 'REJECTED';
  draft.updatedAt = nowIso();
  addExecutionLink(draft, exec.id);
  finishExecution(state, exec.id, 'completed', `Draft ${draft.sellerSku} rejected.`);
  pushAudit(state, 'listing.rejected', `Draft ${draft.sellerSku} rejected.`, actor);
  await services.store.saveState(state);
  return draft;
}

export async function publishDraftNow(services: PipelineServices, draftId: string): Promise<ListingDraft> {
  const state = await services.store.getState();
  const draft = state.listingDrafts.find((item) => item.id === draftId);
  if (!draft) {
    throw new Error('Draft not found.');
  }
  if (draft.status === 'PUBLISHED') {
    return draft;
  }
  if (state.settings.automationMode === 'PAUSED' || !state.settings.publishingEnabled) {
    throw new Error('Publishing is currently paused.');
  }

  const exec = startExecution(state, 'ebay_publisher', 'publish_draft', {
    linkedResourceType: 'draft',
    linkedResourceId: draft.id,
    summary: `Publishing ${draft.sellerSku} to eBay.`,
  });
  draft.status = 'PUBLISHING';
  draft.updatedAt = nowIso();
  addExecutionLink(draft, exec.id);

  const inventory = await services.ebay.createOrReplaceInventoryItem({
    sellerSku: draft.sellerSku,
    title: draft.title,
    description: draft.description,
    images: draft.images,
    quantity: draft.quantity,
  });
  pushExecutionStep(state, exec.id, {
    stepName: 'Create or replace inventory item',
    provider: 'ebay',
    modelName: null,
    requestPurpose: 'Prepare inventory state before offer publish',
    inputSummary: `Seller SKU ${draft.sellerSku} / quantity ${draft.quantity}`,
    outputSummary: `Inventory item ${inventory.inventoryItemId} created or replaced.`,
    durationMs: 90,
    success: true,
    error: null,
  });

  const offer = await services.ebay.publishOffer({
    sellerSku: draft.sellerSku,
    price: draft.price,
    categoryId: draft.offerCategoryId,
  });
  pushExecutionStep(state, exec.id, {
    stepName: 'Publish offer',
    provider: 'ebay',
    modelName: null,
    requestPurpose: 'Publish approved listing offer',
    inputSummary: `Offer for ${draft.sellerSku} at $${draft.price.toFixed(2)}`,
    outputSummary: `Offer ${offer.offerId} published at ${offer.publishedAt}.`,
    durationMs: 120,
    success: true,
    error: null,
  });

  draft.status = 'PUBLISHED';
  draft.publishedAt = offer.publishedAt;
  draft.ebayInventoryItemId = inventory.inventoryItemId;
  draft.ebayOfferId = offer.offerId;
  draft.updatedAt = nowIso();
  const duplicateDetected =
    state.listingDrafts.filter((item) => item.sellerSku === draft.sellerSku && item.id !== draft.id && item.status === 'PUBLISHED').length > 0;
  const publishValidation = validatePublish(exec.id, draft, !Boolean(services.config.ebay.clientId || services.config.ebay.sandboxClientId), duplicateDetected);
  pushValidationRun(state, publishValidation);
  if (publishValidation.status === 'failed') {
    draft.status = 'FAILED';
    finishExecution(state, exec.id, 'failed', `Publish validation failed for ${draft.sellerSku}.`);
    await services.store.saveState(state);
    throw new Error(`Publish validation failed for ${draft.sellerSku}`);
  }
  finishExecution(state, exec.id, 'completed', `Listing ${draft.sellerSku} published successfully.`);
  pushAudit(state, 'listing.published', `Published ${draft.sellerSku} to ${draft.marketplace}.`);
  await services.store.saveState(state);
  return draft;
}

export async function enableApprovalPhase(services: PipelineServices): Promise<void> {
  const state = await services.store.getState();
  const exec = startExecution(state, 'manager', 'mode_change', {
    summary: 'Entering approval-required production phase.',
  });

  state.settings.automationMode = 'APPROVAL_REQUIRED';
  state.settings.publishingEnabled = true;
  state.settings.orderPushEnabled = true;
  state.settings.supportAutoSend = false;
  pushExecutionStep(state, exec.id, {
    stepName: 'Update automation mode',
    provider: 'system',
    modelName: null,
    requestPurpose: 'Switch console from sandbox to approval-required mode',
    inputSummary: 'Current mode SANDBOX',
    outputSummary: 'Publishing enabled, order push enabled, support auto-send disabled.',
    durationMs: 18,
    success: true,
    error: null,
  });
  finishExecution(state, exec.id, 'completed', 'Automation moved to APPROVAL_REQUIRED.');
  pushAudit(state, 'mode.change', 'Automation moved to APPROVAL_REQUIRED.');
  await services.store.saveState(state);
}

export async function resumeAutomation(services: PipelineServices): Promise<void> {
  const state = await services.store.getState();
  const exec = startExecution(state, 'manager', 'resume', {
    summary: 'Resuming automation in approval-required mode.',
  });

  state.settings.automationMode = 'APPROVAL_REQUIRED';
  state.settings.publishingEnabled = true;
  state.settings.orderPushEnabled = true;
  state.settings.supportAutoSend = false;
  pushExecutionStep(state, exec.id, {
    stepName: 'Resume automation',
    provider: 'system',
    modelName: null,
    requestPurpose: 'Re-enable guarded automation',
    inputSummary: 'Owner requested resume.',
    outputSummary: 'Approval-required workflow is active again.',
    durationMs: 12,
    success: true,
    error: null,
  });
  finishExecution(state, exec.id, 'completed', 'Automation resumed in approval-required mode.');
  pushAudit(state, 'automation.resume', 'Automation resumed in approval-required mode.', 'owner');
  await services.store.saveState(state);
}

export async function activateKillSwitch(services: PipelineServices): Promise<void> {
  const state = await services.store.getState();
  const exec = startExecution(state, 'manager', 'kill_switch', {
    summary: 'Emergency kill switch activated.',
  });

  state.settings.automationMode = 'PAUSED';
  state.settings.publishingEnabled = false;
  state.settings.orderPushEnabled = false;
  state.settings.supportAutoSend = false;

  const activeDrafts = state.listingDrafts.filter((draft) => draft.status === 'PUBLISHED' && draft.ebayOfferId);
  pushExecutionStep(state, exec.id, {
    stepName: 'Pause automation',
    provider: 'system',
    modelName: null,
    requestPurpose: 'Stop new autonomous actions',
    inputSummary: `Found ${activeDrafts.length} active managed listings.`,
    outputSummary: 'Publishing, order push, and support auto-send disabled.',
    durationMs: 20,
    success: true,
    error: null,
  });

  for (const draft of activeDrafts) {
    await services.store.enqueueJob('rollback_inventory', { draftId: draft.id, sellerSku: draft.sellerSku });
    await services.store.enqueueJob('rollback_offer', { draftId: draft.id, offerId: draft.ebayOfferId });
    addExecutionLink(draft, exec.id);
  }

  for (const order of state.orders.filter((item) => item.fulfillmentStatus === 'PAID' || item.fulfillmentStatus === 'QUEUED_FOR_PUSH')) {
    order.fulfillmentStatus = 'FULFILLMENT_REVIEW_REQUIRED';
    order.updatedAt = nowIso();
    addExecutionLink(order, exec.id);
  }

  finishExecution(state, exec.id, 'completed', `Kill switch engaged. ${activeDrafts.length} listing(s) scheduled for rollback.`);
  pushAudit(state, 'automation.kill_switch', `Emergency stop engaged for ${activeDrafts.length} managed listings.`, 'owner');
  await services.store.saveState(state);
}

export function lowRiskOrderReasons(order: OrderRecord, state: AppState, candidate: ProductCandidate | undefined): string[] {
  const reasons: string[] = [];
  if (order.orderTotalUsd > 40) {
    reasons.push('Order total exceeds $40.');
  }
  if (order.quantity > 2) {
    reasons.push('Quantity exceeds 2.');
  }
  if (order.destinationCountry !== 'US') {
    reasons.push('Destination is not US.');
  }
  if (isPoBox(order.address.line1) || isMilitaryAddress(order.address.line1, order.address.city)) {
    reasons.push('PO Box / military address is not auto-push eligible.');
  }
  if (!candidate) {
    reasons.push('Candidate not found.');
  } else {
    if (candidate.stock < 10) {
      reasons.push('CJ stock is below 10 units.');
    }
    if (candidate.estimatedDeliveryBusinessDays > 5) {
      reasons.push('Latest CJ shipping ETA exceeds 5 business days.');
    }
    const sameSkuRefunds = state.orders.filter((item) => item.sellerSku === order.sellerSku && item.fulfillmentStatus === 'REFUND_RISK').length;
    const totalSameSku = state.orders.filter((item) => item.sellerSku === order.sellerSku).length || 1;
    if ((sameSkuRefunds / totalSameSku) * 100 > 5) {
      reasons.push('Refund or cancellation rate above 5% for this SKU.');
    }
    if (state.supportThreads.some((thread) => thread.orderId === order.id && thread.state !== 'resolved')) {
      reasons.push('Buyer has an open support thread on the order.');
    }
  }
  return reasons;
}

export async function simulateSupplierFollowUp(services: PipelineServices, chatId: string, ownerMessage: string): Promise<void> {
  const state = await services.store.getState();
  const exec = startExecution(state, 'supplier_liaison', 'supplier_follow_up', {
    linkedResourceType: 'supplier_chat',
    linkedResourceId: chatId,
    summary: 'Owner triggered a supplier follow-up.',
  });
  const chat = appendSupplierMessage(
    state,
    chatId,
    {
      id: createId('msg'),
      sender: 'owner',
      direction: 'outbound',
      message: ownerMessage,
      createdAt: nowIso(),
      provider: 'system',
      modelName: null,
      linkedExecutionId: exec.id,
    },
    'awaiting_reply',
    4,
  );
  if (!chat) {
    throw new Error('Supplier chat not found.');
  }
  chat.linkedExecutionIds = [...new Set([...(chat.linkedExecutionIds || []), exec.id])];
  pushExecutionStep(state, exec.id, {
    stepName: 'Send supplier follow-up',
    provider: 'system',
    modelName: null,
    requestPurpose: 'Log outbound supplier coordination',
    inputSummary: ownerMessage,
    outputSummary: `Supplier thread ${chat.supplierName} updated and marked awaiting reply.`,
    durationMs: 15,
    success: true,
    error: null,
  });

  const reply = {
    id: createId('msg'),
    sender: 'supplier' as const,
    direction: 'inbound' as const,
    message: `Received. ${chat.supplierName} will confirm on ${chat.topic.toLowerCase()} within ${chat.responseEtaHours} hours.`,
    createdAt: nowIso(),
    provider: 'cj' as const,
    modelName: null,
    linkedExecutionId: exec.id,
  };
  appendSupplierMessage(state, chatId, reply, 'online', 2);
  const supplierValidation = validateSupplierLiaison(exec.id, chat, true, chat.responseEtaHours > 8);
  pushValidationRun(state, supplierValidation);
  pushExecutionStep(state, exec.id, {
    stepName: 'Record supplier reply',
    provider: 'cj',
    modelName: null,
    requestPurpose: 'Simulate supplier acknowledgment before live CJ chat hooks exist',
    inputSummary: `Thread ${chat.supplierName}`,
    outputSummary: 'Supplier acknowledgment recorded in the thread timeline.',
    durationMs: 18,
    success: true,
    error: null,
  });
  finishExecution(state, exec.id, 'completed', `Supplier thread ${chat.supplierName} updated with follow-up and acknowledgment.`);
  pushAudit(state, 'supplier.follow_up', `Supplier follow-up logged for ${chat.supplierName}.`, 'owner');
  await services.store.saveState(state);
}

export async function sendCeoMessage(services: PipelineServices, prompt: string): Promise<void> {
  const state = await services.store.getState();
  const exec = startExecution(state, 'manager', 'ceo_chat', {
    linkedResourceType: 'ceo_chat',
    linkedResourceId: 'thread',
    summary: 'CEO chat question received.',
  });

  const ownerMessage: ConversationMessage = {
    id: createId('msg'),
    sender: 'owner',
    direction: 'outbound',
    message: prompt,
    createdAt: nowIso(),
    provider: 'system',
    modelName: null,
    linkedExecutionId: exec.id,
  };
  appendCeoMessage(state, ownerMessage);
  pushExecutionStep(state, exec.id, {
    stepName: 'Receive CEO question',
    provider: 'system',
    modelName: null,
    requestPurpose: 'Log operator question into CEO chat',
    inputSummary: prompt,
    outputSummary: 'CEO thread updated with the new question.',
    durationMs: 8,
    success: true,
    error: null,
  });

  const reply = await services.ai.generateCeoReply(
    state,
    `${prompt} Current system state: ${state.candidates.length} candidates, ${state.listingDrafts.length} drafts, ${state.orders.length} orders, mode ${state.settings.automationMode}.`,
  );
  reply.message.linkedExecutionId = exec.id;
  appendCeoMessage(state, reply.message);
  pushValidationRun(state, validateManager(exec.id, reply.message, true, reply.fallback));
  pushExecutionStep(state, exec.id, {
    stepName: 'Generate CEO response',
    provider: reply.message.provider || 'system',
    modelName: reply.message.modelName || null,
    requestPurpose: 'Explain current operations and priorities',
    inputSummary: `Prompt plus state snapshot in mode ${state.settings.automationMode}.`,
    outputSummary: `${reply.fallback ? 'Internal fallback logic' : 'AI response'} returned a CEO summary.`,
    durationMs: 145,
    success: true,
    error: null,
  });
  finishExecution(state, exec.id, 'completed', 'CEO chat response generated.');
  pushAudit(state, 'ceo.chat', 'CEO chat response generated.', 'owner');
  await services.store.saveState(state);
}

export async function processJob(services: PipelineServices, job: WorkerJob): Promise<void> {
  switch (job.type) {
    case 'discovery':
      await runDiscoveryCycle(services);
      return;
    case 'publish_listing': {
      const draftId = String(job.payload.draftId || '');
      await publishDraftNow(services, draftId);
      return;
    }
    case 'rollback_inventory': {
      const state = await services.store.getState();
      const sellerSku = String(job.payload.sellerSku || '');
      const exec = startExecution(state, 'ebay_publisher', 'rollback_inventory', {
        parentJobId: job.id,
        linkedResourceType: 'seller_sku',
        linkedResourceId: sellerSku,
        summary: `Rollback inventory for ${sellerSku}.`,
      });
      await services.ebay.updateInventoryQuantity(sellerSku, 0);
      pushExecutionStep(state, exec.id, {
        stepName: 'Set inventory quantity to zero',
        provider: 'ebay',
        modelName: null,
        requestPurpose: 'Stop sales immediately after emergency rollback',
        inputSummary: `Seller SKU ${sellerSku}`,
        outputSummary: 'Inventory quantity updated to zero.',
        durationMs: 60,
        success: true,
        error: null,
      });
      finishExecution(state, exec.id, 'completed', `Inventory for ${sellerSku} set to zero.`);
      await services.store.saveState(state);
      return;
    }
    case 'rollback_offer': {
      const state = await services.store.getState();
      const offerId = String(job.payload.offerId || '');
      const exec = startExecution(state, 'ebay_publisher', 'rollback_offer', {
        parentJobId: job.id,
        linkedResourceType: 'offer',
        linkedResourceId: offerId,
        summary: `Withdraw eBay offer ${offerId}.`,
      });
      await services.ebay.withdrawOffer(offerId);
      pushExecutionStep(state, exec.id, {
        stepName: 'Withdraw offer',
        provider: 'ebay',
        modelName: null,
        requestPurpose: 'Finish the emergency listing rollback',
        inputSummary: `Offer ${offerId}`,
        outputSummary: 'Offer withdrawn from eBay.',
        durationMs: 65,
        success: true,
        error: null,
      });
      finishExecution(state, exec.id, 'completed', `Offer ${offerId} withdrawn.`);
      await services.store.saveState(state);
      return;
    }
    case 'order_push': {
      const state = await services.store.getState();
      const orderId = String(job.payload.orderId || '');
      const exec = startExecution(state, 'fulfillment', 'order_push', {
        parentJobId: job.id,
        linkedResourceType: 'order',
        linkedResourceId: orderId,
        summary: `Evaluating order ${orderId} for low-risk CJ push.`,
      });
      const order = state.orders.find((item) => item.id === orderId);
      if (!order) {
        throw new Error('Order not found for push.');
      }
      addExecutionLink(order, exec.id);
      const draft = state.listingDrafts.find((item) => item.id === order.draftId);
      const candidate = state.candidates.find((item) => item.id === draft?.candidateId);
      const reasons = lowRiskOrderReasons(order, state, candidate);
      pushExecutionStep(state, exec.id, {
        stepName: 'Evaluate low-risk rules',
        provider: 'system',
        modelName: null,
        requestPurpose: 'Check auto-push eligibility',
        inputSummary: `Order total $${order.orderTotalUsd.toFixed(2)} / quantity ${order.quantity}`,
        outputSummary: reasons.length ? `Manual review required: ${reasons.join(' ')}` : 'Order passed low-risk auto-push rules.',
        durationMs: 32,
        success: true,
        error: null,
      });

      if (reasons.length > 0 || !candidate || !services.config.cj.accessToken) {
        order.fulfillmentStatus = 'FULFILLMENT_REVIEW_REQUIRED';
        pushValidationRun(state, validateFulfillment(exec.id, order, null, reasons, false, !services.config.cj.accessToken));
        pushAudit(state, 'order.review_required', `Order ${order.ebayOrderId} requires manual fulfillment review.`);
        finishExecution(state, exec.id, 'completed', `Order ${order.ebayOrderId} moved to manual review.`);
        await services.store.saveState(state);
        return;
      }

      const idempotencyKey = sha256(`${order.ebayOrderId}:${order.sellerSku}:${order.quantity}:${order.address.postalCode}`);
      let fulfillment = state.fulfillmentJobs.find((item) => item.idempotencyKey === idempotencyKey);
      if (!fulfillment) {
        fulfillment = {
          id: createId('fulfillment'),
          orderId: order.id,
          idempotencyKey,
          cjOrderId: null,
          status: 'PENDING',
          attemptCount: 0,
          lastError: null,
          linkedExecutionIds: [exec.id],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        state.fulfillmentJobs.unshift(fulfillment);
      }
      addExecutionLink(fulfillment, exec.id);
      if (fulfillment.cjOrderId) {
        order.fulfillmentStatus = 'PLACED';
        finishExecution(state, exec.id, 'completed', `Order ${order.ebayOrderId} was already placed in CJ.`);
        await services.store.saveState(state);
        return;
      }

      const placed = await services.cj.placeOrder({
        idempotencyKey,
        orderId: order.ebayOrderId,
        productId: candidate.cjProductId,
        variantId: candidate.cjVariantId,
        quantity: order.quantity,
      });
      fulfillment.cjOrderId = placed.cjOrderId;
      fulfillment.status = 'PLACED';
      fulfillment.attemptCount += 1;
      fulfillment.updatedAt = nowIso();
      order.fulfillmentStatus = 'PLACED';
      order.updatedAt = nowIso();
      pushValidationRun(state, validateFulfillment(exec.id, order, fulfillment, [], true, false));
      pushExecutionStep(state, exec.id, {
        stepName: 'Place CJ order',
        provider: 'cj',
        modelName: null,
        requestPurpose: 'Push low-risk order to CJ fulfillment',
        inputSummary: `Order ${order.ebayOrderId} / idempotency ${idempotencyKey.slice(0, 10)}`,
        outputSummary: `CJ order ${placed.cjOrderId} created successfully.`,
        durationMs: 110,
        success: true,
        error: null,
      });
      finishExecution(state, exec.id, 'completed', `Placed CJ order ${placed.cjOrderId} for ${order.ebayOrderId}.`);
      pushAudit(state, 'order.auto_push', `Placed CJ order ${placed.cjOrderId} for ${order.ebayOrderId}.`);
      await services.store.saveState(state);
      return;
    }
    default:
      return;
  }
}

export async function rerunValidationForExecution(services: PipelineServices, executionId: string): Promise<void> {
  const state = await services.store.getState();
  const execution = state.agentExecutions.find((item) => item.id === executionId);
  const latest = findLatestValidationForExecution(state, executionId);
  if (!execution || !latest) {
    throw new Error('Validation execution not found.');
  }

  switch (latest.agentId) {
    case 'cj_match': {
      const candidate = state.candidates.find((item) => item.id === latest.resourceId);
      if (!candidate) throw new Error('Candidate not found.');
      pushValidationRun(state, validateCjMatch(executionId, candidate, state.connections.find((item) => item.name === 'CJdropshipping')?.status !== 'connected'));
      break;
    }
    case 'product_scoring': {
      const candidate = state.candidates.find((item) => item.id === latest.resourceId);
      if (!candidate) throw new Error('Candidate not found.');
      pushValidationRun(state, validateProductScoring(executionId, candidate, state.connections.find((item) => item.name === 'eBay')?.status !== 'connected'));
      break;
    }
    case 'listing_generator': {
      const draft = state.listingDrafts.find((item) => item.id === latest.resourceId);
      if (!draft) throw new Error('Draft not found.');
      pushValidationRun(
        state,
        validateListingGenerator(executionId, draft, {
          fallbackUsed: draft.warningMessages.some((warning) => warning.toLowerCase().includes('template')),
          simulatedPolicy: state.connections.find((item) => item.name === 'eBay')?.status !== 'connected',
          categoryWarnings: draft.warningMessages,
          refinementCount: latest.refinementCount,
        }),
      );
      break;
    }
    case 'ebay_publisher': {
      const draft = state.listingDrafts.find((item) => item.id === latest.resourceId);
      if (!draft) throw new Error('Draft not found.');
      const duplicateDetected = state.listingDrafts.filter((item) => item.sellerSku === draft.sellerSku && item.id !== draft.id && item.status === 'PUBLISHED').length > 0;
      pushValidationRun(state, validatePublish(executionId, draft, state.connections.find((item) => item.name === 'eBay')?.status !== 'connected', duplicateDetected));
      break;
    }
    case 'fulfillment': {
      const order = state.orders.find((item) => item.id === latest.resourceId);
      if (!order) throw new Error('Order not found.');
      const fulfillment = state.fulfillmentJobs.find((item) => item.orderId === order.id) || null;
      const draft = state.listingDrafts.find((item) => item.id === order.draftId);
      const candidate = state.candidates.find((item) => item.id === draft?.candidateId);
      const reasons = lowRiskOrderReasons(order, state, candidate);
      pushValidationRun(
        state,
        validateFulfillment(executionId, order, fulfillment, reasons, Boolean(fulfillment?.cjOrderId), state.connections.find((item) => item.name === 'CJdropshipping')?.status !== 'connected'),
      );
      break;
    }
    case 'supplier_liaison': {
      const chat = state.supplierChats.find((item) => item.id === latest.resourceId);
      if (!chat) throw new Error('Supplier chat not found.');
      pushValidationRun(state, validateSupplierLiaison(executionId, chat, true, chat.responseEtaHours > 8));
      break;
    }
    case 'manager': {
      const message = state.ceoChat.messages[state.ceoChat.messages.length - 1];
      if (!message) throw new Error('CEO message not found.');
      pushValidationRun(state, validateManager(executionId, message, true, message.provider === 'system'));
      break;
    }
    case 'trend_discovery': {
      const scanned = state.candidates.length;
      const shortlisted = state.candidates.filter((item) => item.status === 'READY_TO_LIST' || item.status === 'TEST_ONLY').length;
      pushValidationRun(state, validateTrendDiscovery(executionId, scanned, shortlisted, state.connections.find((item) => item.name === 'CJdropshipping')?.status !== 'connected'));
      break;
    }
    default:
      break;
  }

  pushAudit(state, 'validation.rerun', `Validation rerun completed for execution ${executionId}.`, 'owner');
  await services.store.saveState(state);
}

export async function refineValidationForExecution(services: PipelineServices, executionId: string): Promise<void> {
  const state = await services.store.getState();
  const latest = findLatestValidationForExecution(state, executionId);
  if (!latest) {
    throw new Error('Validation execution not found.');
  }

  switch (latest.agentId) {
    case 'listing_generator': {
      const draft = state.listingDrafts.find((item) => item.id === latest.resourceId);
      const candidate = state.candidates.find((item) => item.id === draft?.candidateId);
      if (!draft || !candidate) {
        throw new Error('Draft or candidate not found.');
      }
      const generated = await services.ai.generateListingPack(state, candidate.sourceFingerprint, candidate);
      draft.title = generated.pack.title;
      draft.subtitle = generated.pack.subtitle;
      draft.description = generated.pack.description;
      draft.bullets = generated.pack.bullets;
      draft.itemSpecifics = generated.pack.itemSpecifics;
      draft.images = generated.pack.images;
      draft.updatedAt = nowIso();
      pushValidationRun(
        state,
        validateListingGenerator(executionId, draft, {
          fallbackUsed: generated.fallback,
          simulatedPolicy: state.connections.find((item) => item.name === 'eBay')?.status !== 'connected',
          categoryWarnings: draft.warningMessages,
          refinementCount: latest.refinementCount + 1,
        }),
      );
      break;
    }
    case 'product_scoring': {
      const candidate = state.candidates.find((item) => item.id === latest.resourceId);
      if (!candidate) {
        throw new Error('Candidate not found.');
      }
      const snapshot = await services.ebay.getMarketSnapshot(candidate.normalizedKeyword);
      candidate.searchSnapshot = snapshot;
      candidate.scoreBreakdown = scoreCandidate({
        product: {
          id: candidate.cjProductId,
          variantId: candidate.cjVariantId,
          title: candidate.title,
          normalizedKeyword: candidate.normalizedKeyword,
          categoryPath: candidate.categoryPath,
          warehouseCountry: candidate.warehouseCountry,
          landedCost: candidate.landedCost,
          shippingCost: candidate.shippingCost,
          stock: candidate.stock,
          estimatedDeliveryBusinessDays: candidate.estimatedDeliveryBusinessDays,
          supplierName: candidate.supplierName,
          supplierAgeDays: 180,
          shippingConsistency: 85,
          stockStability: 84,
          orderHistoryScore: 82,
          imageUrl: candidate.imageUrl,
          tags: candidate.tags,
        },
        snapshot,
        policyState: candidate.policyState,
      });
      candidate.status = candidate.scoreBreakdown.decision;
      candidate.updatedAt = nowIso();
      pushValidationRun(state, validateProductScoring(executionId, candidate, state.connections.find((item) => item.name === 'eBay')?.status !== 'connected'));
      break;
    }
    case 'supplier_liaison':
      await services.store.saveState(state);
      await simulateSupplierFollowUp(services, latest.resourceId, 'Following up on the previous validation warning. Please reconfirm timing and availability.');
      return;
    case 'manager':
      await services.store.saveState(state);
      await sendCeoMessage(services, 'Please refine the previous manager summary with clearer routing and validation context.');
      return;
    default:
      break;
  }

  pushAudit(state, 'validation.refine', `Refinement run completed for execution ${executionId}.`, 'owner');
  await services.store.saveState(state);
}

export async function recordDeadLetter(services: PipelineServices, job: WorkerJob, error: Error): Promise<void> {
  const state = await services.store.getState();
  const exec = startExecution(state, 'manager', 'dead_letter', {
    parentJobId: job.id,
    linkedResourceType: job.type,
    linkedResourceId: String(job.payload.draftId || job.payload.orderId || job.payload.sellerSku || 'unknown'),
    summary: `Job ${job.id} moved to dead-letter queue.`,
  });
  const deadLetter: DeadLetter = {
    id: createId('dlq'),
    jobId: job.id,
    resourceType: job.type,
    resourceId: String(job.payload.draftId || job.payload.orderId || job.payload.sellerSku || 'unknown'),
    stage: job.type,
    provider: job.type.includes('order') ? 'cj' : job.type.includes('publish') || job.type.includes('rollback') ? 'ebay' : 'system',
    errorClass: error.name || 'Error',
    payloadSnapshot: JSON.stringify(job.payload),
    attemptCount: job.attemptCount,
    firstFailedAt: nowIso(),
    lastFailedAt: nowIso(),
    resolvedAt: null,
    resolutionNote: null,
  };
  pushExecutionStep(state, exec.id, {
    stepName: 'Move job to dead letter queue',
    provider: deadLetter.provider,
    modelName: null,
    requestPurpose: 'Preserve failed work for manual review',
    inputSummary: `Job ${job.type} failed after ${job.attemptCount} attempt(s).`,
    outputSummary: `${deadLetter.resourceType} ${deadLetter.resourceId} stored for manual review.`,
    durationMs: 20,
    success: false,
    error: error.message,
  });
  finishExecution(state, exec.id, 'failed', `Dead letter created for ${deadLetter.resourceType} ${deadLetter.resourceId}.`);
  state.deadLetters.unshift(deadLetter);
  pushAudit(state, 'dead_letter.created', `Job ${job.id} moved to dead-letter queue: ${error.message}.`);
  await services.store.saveState(state);
}

export function nextRetryIso(attemptCount: number): string {
  const delays = [30_000, 120_000, 600_000];
  const base = delays[Math.min(delays.length - 1, Math.max(0, attemptCount - 1))];
  return new Date(Date.now() + withJitter(base)).toISOString();
}
