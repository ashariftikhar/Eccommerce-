import {
  AppState,
  DeadLetter,
  FulfillmentJob,
  ListingDraft,
  OrderRecord,
  ProductCandidate,
  RuntimeConfig,
  SupportThread,
  WorkerJob,
} from '../types';
import { evaluatePolicy } from './policy';
import { AIClient, CJClient, EbayClient } from './providers';
import { scoreCandidate } from './scoring';
import { createStoreAdapter, pushAudit, pushRun, StoreAdapter } from './store';
import { clamp, createId, isMilitaryAddress, isPoBox, normalizeKeyword, nowIso, sha256, shortHash, withJitter } from './utils';

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
  const catalog = await services.cj.fetchCatalog(services.config.cj.scanLimit);
  const converted = catalog.map(convertProduct);
  const shortlisted = converted.filter((candidate) => prefilterProduct(candidate, state).length === 0).slice(0, 80);

  let drafted = 0;
  for (const candidate of shortlisted) {
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

    const existing = state.candidates.find((item) => item.sourceFingerprint === candidate.sourceFingerprint);
    if (existing) {
      Object.assign(existing, candidate, { id: existing.id, createdAt: existing.createdAt });
    } else {
      state.candidates.unshift(candidate);
    }

    if ((candidate.status === 'READY_TO_LIST' || candidate.status === 'TEST_ONLY') && !state.listingDrafts.some((draft) => draft.candidateId === (existing?.id || candidate.id))) {
      const pack = await services.ai.generateListingPack(state, candidate.sourceFingerprint, candidate);
      const categoryPolicies = await services.ebay.validateCategoryPolicies(candidate);
      const draft: ListingDraft = {
        id: createId('draft'),
        candidateId: existing?.id || candidate.id,
        marketplace: 'EBAY_US',
        sellerSku: candidate.sellerSku,
        title: pack.title,
        subtitle: pack.subtitle,
        description: pack.description,
        bullets: pack.bullets,
        itemSpecifics: pack.itemSpecifics,
        images: pack.images,
        price: candidate.targetPrice,
        quantity: clamp(candidate.stock, 1, 25),
        warningMessages: [...candidate.policyMatches, ...categoryPolicies.warnings],
        status: 'DRAFT_READY',
        approvalRequired: state.settings.automationMode !== 'AUTO_PUBLISH',
        publishedAt: null,
        ebayInventoryItemId: null,
        ebayOfferId: null,
        offerCategoryId: categoryPolicies.categoryId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (categoryPolicies.valid) {
        state.listingDrafts.unshift(draft);
        drafted += 1;
      }
    }
  }

  state.settings.lastDiscoveryRunAt = nowIso();
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
  draft.status = 'APPROVED';
  draft.updatedAt = nowIso();
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
  draft.status = 'REJECTED';
  draft.updatedAt = nowIso();
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

  draft.status = 'PUBLISHING';
  draft.updatedAt = nowIso();
  const inventory = await services.ebay.createOrReplaceInventoryItem({
    sellerSku: draft.sellerSku,
    title: draft.title,
    description: draft.description,
    images: draft.images,
    quantity: draft.quantity,
  });
  const offer = await services.ebay.publishOffer({
    sellerSku: draft.sellerSku,
    price: draft.price,
    categoryId: draft.offerCategoryId,
  });
  draft.status = 'PUBLISHED';
  draft.publishedAt = offer.publishedAt;
  draft.ebayInventoryItemId = inventory.inventoryItemId;
  draft.ebayOfferId = offer.offerId;
  draft.updatedAt = nowIso();
  pushAudit(state, 'listing.published', `Published ${draft.sellerSku} to ${draft.marketplace}.`);
  await services.store.saveState(state);
  return draft;
}

export async function enableApprovalPhase(services: PipelineServices): Promise<void> {
  const state = await services.store.getState();
  state.settings.automationMode = 'APPROVAL_REQUIRED';
  state.settings.publishingEnabled = true;
  state.settings.orderPushEnabled = true;
  state.settings.supportAutoSend = false;
  pushAudit(state, 'mode.change', 'Automation moved to APPROVAL_REQUIRED.');
  await services.store.saveState(state);
}

export async function resumeAutomation(services: PipelineServices): Promise<void> {
  const state = await services.store.getState();
  state.settings.automationMode = 'APPROVAL_REQUIRED';
  state.settings.publishingEnabled = true;
  state.settings.orderPushEnabled = true;
  state.settings.supportAutoSend = false;
  pushAudit(state, 'automation.resume', 'Automation resumed in approval-required mode.', 'owner');
  await services.store.saveState(state);
}

export async function activateKillSwitch(services: PipelineServices): Promise<void> {
  const state = await services.store.getState();
  state.settings.automationMode = 'PAUSED';
  state.settings.publishingEnabled = false;
  state.settings.orderPushEnabled = false;
  state.settings.supportAutoSend = false;

  const activeDrafts = state.listingDrafts.filter((draft) => draft.status === 'PUBLISHED' && draft.ebayOfferId);
  for (const draft of activeDrafts) {
    await services.store.enqueueJob('rollback_inventory', { draftId: draft.id, sellerSku: draft.sellerSku });
    await services.store.enqueueJob('rollback_offer', { draftId: draft.id, offerId: draft.ebayOfferId });
  }

  for (const order of state.orders.filter((item) => item.fulfillmentStatus === 'PAID' || item.fulfillmentStatus === 'QUEUED_FOR_PUSH')) {
    order.fulfillmentStatus = 'FULFILLMENT_REVIEW_REQUIRED';
    order.updatedAt = nowIso();
  }

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
      const sellerSku = String(job.payload.sellerSku || '');
      await services.ebay.updateInventoryQuantity(sellerSku, 0);
      return;
    }
    case 'rollback_offer': {
      const offerId = String(job.payload.offerId || '');
      await services.ebay.withdrawOffer(offerId);
      return;
    }
    case 'order_push': {
      const orderId = String(job.payload.orderId || '');
      const state = await services.store.getState();
      const order = state.orders.find((item) => item.id === orderId);
      if (!order) {
        throw new Error('Order not found for push.');
      }
      const draft = state.listingDrafts.find((item) => item.id === order.draftId);
      const candidate = state.candidates.find((item) => item.id === draft?.candidateId);
      const reasons = lowRiskOrderReasons(order, state, candidate);
      if (reasons.length > 0 || !candidate || !services.config.cj.accessToken) {
        order.fulfillmentStatus = 'FULFILLMENT_REVIEW_REQUIRED';
        pushAudit(state, 'order.review_required', `Order ${order.ebayOrderId} requires manual fulfillment review.`);
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
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        state.fulfillmentJobs.unshift(fulfillment);
      }
      if (fulfillment.cjOrderId) {
        order.fulfillmentStatus = 'PLACED';
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
      pushAudit(state, 'order.auto_push', `Placed CJ order ${placed.cjOrderId} for ${order.ebayOrderId}.`);
      await services.store.saveState(state);
      return;
    }
    default:
      return;
  }
}

export async function recordDeadLetter(services: PipelineServices, job: WorkerJob, error: Error): Promise<void> {
  const state = await services.store.getState();
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
  state.deadLetters.unshift(deadLetter);
  pushAudit(state, 'dead_letter.created', `Job ${job.id} moved to dead-letter queue: ${error.message}.`);
  await services.store.saveState(state);
}

export function nextRetryIso(attemptCount: number): string {
  const delays = [30_000, 120_000, 600_000];
  const base = delays[Math.min(delays.length - 1, Math.max(0, attemptCount - 1))];
  return new Date(Date.now() + withJitter(base)).toISOString();
}
