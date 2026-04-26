import { createId, nowIso } from './utils';
function computeRunStatus(results) {
    const hardFailed = results.some((result) => result.severity === 'hard' && result.status === 'failed');
    const softFailed = results.some((result) => result.severity === 'soft' && result.status === 'failed');
    const warnings = results.some((result) => result.status === 'warning');
    const passedCount = results.filter((result) => result.status === 'passed').length;
    const total = Math.max(1, results.length);
    const score = Math.max(0, Math.min(100, Math.round((passedCount / total) * 100 -
        results.filter((result) => result.status === 'warning').length * 7 -
        results.filter((result) => result.status === 'failed').length * 20)));
    if (hardFailed) {
        return { status: 'failed', blocking: true, score };
    }
    if (softFailed) {
        return { status: 'failed', blocking: false, score };
    }
    if (warnings) {
        return { status: 'warning', blocking: false, score };
    }
    return { status: 'passed', blocking: false, score };
}
function makeValidator(validatorId, name, severity, ok, expected, observed, warning = false) {
    return {
        validatorId,
        name,
        severity,
        status: ok ? (warning ? 'warning' : 'passed') : 'failed',
        message: ok ? (warning ? `${name} passed with warning.` : `${name} passed.`) : `${name} failed.`,
        expected,
        observed,
    };
}
export function buildValidationRun(input) {
    const computed = computeRunStatus(input.validatorResults);
    return {
        id: createId('validation'),
        agentId: input.agentId,
        executionId: input.executionId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        status: computed.status,
        blocking: computed.blocking,
        score: computed.score,
        refinementCount: input.refinementCount ?? 0,
        simulatedData: input.simulatedData ?? false,
        fallbackUsed: input.fallbackUsed ?? false,
        validatorResults: input.validatorResults,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
}
export function summarizeValidationRuns(state) {
    return state.agentDefinitions.map((definition) => {
        const runs = state.validationRuns.filter((run) => run.agentId === definition.id);
        return {
            agentId: definition.id,
            passed: runs.filter((run) => run.status === 'passed').length,
            warning: runs.filter((run) => run.status === 'warning').length,
            failed: runs.filter((run) => run.status === 'failed').length,
        };
    });
}
export function architectureFlowchart() {
    return [
        'flowchart TD',
        '  A["Trend Discovery Agent"] --> B["CJ Match Agent"]',
        '  B --> C["Product Scoring Engine"]',
        '  C -->|Ready/Test| D["Listing Generator Agent"]',
        '  C -->|Blocked| X["Validation Block / Manual Review"]',
        '  D --> E["Listing Validation"]',
        '  E -->|Pass| F["Owner Approval / Auto Approval"]',
        '  E -->|Warn| R["Refinement Loop"]',
        '  E -->|Fail| X',
        '  F --> G["eBay Listing Publisher"]',
        '  G --> H["Publish Validation"]',
        '  H -->|Pass| I["Order Monitoring / Orders"]',
        '  H -->|Fail| X',
        '  I --> J["Fulfillment Agent"]',
        '  J --> K["Fulfillment Validation"]',
        '  K -->|Pass| L["Tracking / Store State"]',
        '  K -->|Fail| X',
        '  I --> M["Customer Support Agent"]',
        '  B --> N["Supplier Liaison Agent"]',
        '  M --> O["Manager Agent"]',
        '  N --> O',
        '  X --> O',
        '  R --> D',
    ].join('\n');
}
export function architectureRoutingRules() {
    return [
        'trend_discovery hands off only to cj_match.',
        'cj_match sends qualified US-warehouse candidates to product_scoring and may notify supplier_liaison.',
        'product_scoring routes READY_TO_LIST and TEST_ONLY candidates to listing_generator; BLOCKED candidates stop at validation review.',
        'listing_generator continues to approval/publisher on pass, loops once on warning/refinement, and blocks on failed validation.',
        'ebay_publisher must pass publish validation before a listing is considered live.',
        'fulfillment can place CJ orders only after low-risk validation passes.',
        'customer_support stays draft-only for unsafe or ambiguous outputs.',
        'manager observes blocked, warning, fallback, and escalation states but does not directly auto-route customer-sensitive actions.',
    ];
}
export function architectureFailureMatrix() {
    return [
        { id: 'f1', stage: 'Discovery', failure: 'No usable catalog data', handling: 'Block downstream discovery and raise alert.' },
        { id: 'f2', stage: 'Supplier Match', failure: 'Non-US, low-stock, or missing cost/ETA', handling: 'Candidate blocked and retained for review.' },
        { id: 'f3', stage: 'Scoring', failure: 'Incomplete score breakdown or invalid decision', handling: 'Block listing generation and move to validation review.' },
        { id: 'f4', stage: 'Listing', failure: 'Missing title/specs/images/price', handling: 'Regenerate once, then block and review.' },
        { id: 'f5', stage: 'Publish', failure: 'Inventory or offer publish failure', handling: 'Stop listing handoff and preserve rollback path.' },
        { id: 'f6', stage: 'Fulfillment', failure: 'Invalid linkage or CJ placement failure', handling: 'Downgrade to manual fulfillment review.' },
        { id: 'f7', stage: 'Support', failure: 'Unsafe automated support content', handling: 'Block auto-send and escalate to owner.' },
    ];
}
export function validateTrendDiscovery(executionId, scanned, shortlisted, usedSynthetic) {
    return buildValidationRun({
        agentId: 'trend_discovery',
        executionId,
        resourceType: 'execution',
        resourceId: executionId,
        simulatedData: usedSynthetic,
        validatorResults: [
            makeValidator('catalog-availability', 'Catalog availability', 'hard', scanned > 0, 'At least 1 candidate in catalog', `Scanned ${scanned} candidates`),
            makeValidator('candidate-threshold', 'Candidate threshold', 'soft', shortlisted >= 5, 'At least 5 shortlisted candidates', `${shortlisted} shortlisted candidates`, shortlisted >= 5 ? false : true),
            makeValidator('synthetic-warning', 'Synthetic source warning', 'soft', true, 'Real CJ data preferred', usedSynthetic ? 'Synthetic CJ fallback used' : 'Real CJ data used', usedSynthetic),
        ],
    });
}
export function validateCjMatch(executionId, candidate, simulated) {
    return buildValidationRun({
        agentId: 'cj_match',
        executionId,
        resourceType: 'candidate',
        resourceId: candidate.id,
        simulatedData: simulated,
        validatorResults: [
            makeValidator('us-warehouse', 'US warehouse', 'hard', candidate.warehouseCountry === 'US', 'US warehouse', candidate.warehouseCountry),
            makeValidator('stock-threshold', 'Stock threshold', 'hard', candidate.stock > 20, 'Stock above 20', `${candidate.stock}`),
            makeValidator('eta-threshold', 'ETA threshold', 'hard', candidate.estimatedDeliveryBusinessDays <= 5, 'ETA <= 5 business days', `${candidate.estimatedDeliveryBusinessDays} business days`),
            makeValidator('landed-cost', 'Landed cost present', 'hard', candidate.landedCost > 0, 'Landed cost > 0', `${candidate.landedCost}`),
            makeValidator('supplier-identity', 'Supplier identity present', 'hard', Boolean(candidate.supplierName), 'Non-empty supplier name', candidate.supplierName || 'missing'),
            makeValidator('policy-block', 'Policy block clear', 'hard', candidate.policyState !== 'blocked', 'Policy state not blocked', candidate.policyState),
            makeValidator('simulated-supplier', 'Supplier data mode', 'soft', true, 'Real supplier data preferred', simulated ? 'Synthetic / cached supplier signals' : 'Real supplier data', simulated),
        ],
    });
}
export function validateProductScoring(executionId, candidate, simulatedMarket) {
    const score = candidate.scoreBreakdown;
    return buildValidationRun({
        agentId: 'product_scoring',
        executionId,
        resourceType: 'candidate',
        resourceId: candidate.id,
        simulatedData: simulatedMarket,
        validatorResults: [
            makeValidator('score-breakdown', 'Score breakdown present', 'hard', Boolean(score), 'Complete score breakdown', score ? 'present' : 'missing'),
            makeValidator('decision-present', 'Decision present', 'hard', Boolean(score?.decision), 'Decision present', score?.decision || 'missing'),
            makeValidator('total-range', 'Total score in range', 'hard', typeof score?.totalScore === 'number' && score.totalScore >= 0 && score.totalScore <= 100, 'Total score between 0 and 100', score ? `${score.totalScore}` : 'missing'),
            makeValidator('decision-consistency', 'Decision consistency', 'hard', !score || !(score.decision === 'READY_TO_LIST' && score.hardRejectReasons.length > 0), 'READY_TO_LIST should not include hard reject reasons', score ? `${score.decision} / rejects ${score.hardRejectReasons.length}` : 'missing'),
            makeValidator('simulated-market', 'Market data mode', 'soft', true, 'Real eBay market data preferred', simulatedMarket ? 'Simulated market snapshot used' : 'Real eBay market snapshot used', simulatedMarket),
        ],
    });
}
export function validateListingGenerator(executionId, draft, options) {
    return buildValidationRun({
        agentId: 'listing_generator',
        executionId,
        resourceType: 'draft',
        resourceId: draft.id,
        fallbackUsed: options.fallbackUsed,
        simulatedData: options.simulatedPolicy,
        refinementCount: options.refinementCount ?? 0,
        validatorResults: [
            makeValidator('title', 'Title present', 'hard', Boolean(draft.title.trim()), 'Non-empty title', draft.title || 'missing'),
            makeValidator('description', 'Description present', 'hard', Boolean(draft.description.trim()), 'Non-empty description', draft.description ? 'present' : 'missing'),
            makeValidator('item-specifics', 'Item specifics present', 'hard', Object.keys(draft.itemSpecifics).length > 0, 'At least 1 item specific', `${Object.keys(draft.itemSpecifics).length} specifics`),
            makeValidator('price', 'Price present', 'hard', draft.price > 0, 'Price > 0', `${draft.price}`),
            makeValidator('images', 'Images present', 'hard', draft.images.length > 0, 'At least 1 image', `${draft.images.length} images`),
            makeValidator('fallback', 'Fallback usage', 'soft', true, 'AI-generated content preferred', options.fallbackUsed ? 'Template fallback used' : 'AI-generated content used', options.fallbackUsed),
            makeValidator('category-policy', 'Category policy warning', 'soft', true, 'No category policy warnings', options.categoryWarnings.length ? options.categoryWarnings[0] : 'No warnings', options.categoryWarnings.length > 0),
        ],
    });
}
export function validatePublish(executionId, draft, simulated, duplicateDetected = false) {
    return buildValidationRun({
        agentId: 'ebay_publisher',
        executionId,
        resourceType: 'draft',
        resourceId: draft.id,
        simulatedData: simulated,
        validatorResults: [
            makeValidator('inventory-id', 'Inventory item created', 'hard', Boolean(draft.ebayInventoryItemId), 'Inventory item id present', draft.ebayInventoryItemId || 'missing'),
            makeValidator('offer-id', 'Offer published', 'hard', Boolean(draft.ebayOfferId), 'Offer id present', draft.ebayOfferId || 'missing'),
            makeValidator('duplicate-sku', 'Duplicate SKU prevention', 'hard', !duplicateDetected, 'No duplicate SKU state', duplicateDetected ? 'duplicate detected' : 'no duplicate detected'),
            makeValidator('publish-mode', 'Publish mode warning', 'soft', true, 'Production publish preferred after sandbox', simulated ? 'Sandbox / simulated publish mode' : 'Production-capable publish mode', simulated),
        ],
    });
}
export function validateFulfillment(executionId, order, fulfillment, reasons, placed, simulated) {
    return buildValidationRun({
        agentId: 'fulfillment',
        executionId,
        resourceType: 'order',
        resourceId: order.id,
        simulatedData: simulated,
        validatorResults: [
            makeValidator('idempotency', 'Idempotency key present', 'hard', Boolean(fulfillment?.idempotencyKey), 'Idempotency key present', fulfillment?.idempotencyKey || 'missing'),
            makeValidator('linkage', 'Order linkage valid', 'hard', Boolean(order.draftId && order.sellerSku), 'Draft and SKU linkage present', `${order.draftId || 'missing draft'} / ${order.sellerSku || 'missing sku'}`),
            makeValidator('cj-placement', 'CJ placement', 'hard', reasons.length === 0 ? placed : true, 'Placed successfully when low-risk passes', reasons.length ? `manual review: ${reasons.join(' ')}` : placed ? 'placed' : 'not placed'),
            makeValidator('manual-review', 'Manual review downgrade', 'soft', true, 'No soft risk triggers', reasons.length ? reasons.join(' ') : 'No soft risk triggers', reasons.length > 0),
        ],
    });
}
export function validateSupplierLiaison(executionId, chat, simulated, etaExceeded) {
    return buildValidationRun({
        agentId: 'supplier_liaison',
        executionId,
        resourceType: 'supplier_chat',
        resourceId: chat.id,
        simulatedData: simulated,
        validatorResults: [
            makeValidator('thread-exists', 'Supplier thread exists', 'hard', Boolean(chat.id), 'Existing supplier thread', chat.id || 'missing'),
            makeValidator('reply-eta', 'Reply ETA threshold', 'soft', true, 'Reply ETA within threshold', etaExceeded ? `ETA exceeded: ${chat.responseEtaHours}h` : `ETA ${chat.responseEtaHours}h`, etaExceeded),
            makeValidator('simulated-reply', 'Simulated reply warning', 'soft', true, 'Live supplier hooks preferred', simulated ? 'Simulated supplier reply used' : 'Live supplier signal used', simulated),
        ],
    });
}
export function validateManager(executionId, message, hasLinkedTrace, fallbackUsed) {
    return buildValidationRun({
        agentId: 'manager',
        executionId,
        resourceType: 'ceo_chat',
        resourceId: 'thread',
        fallbackUsed,
        validatorResults: [
            makeValidator('linked-trace', 'Linked trace present', 'hard', hasLinkedTrace, 'Linked trace for recommendation', hasLinkedTrace ? 'linked trace present' : 'missing linked trace'),
            makeValidator('provider-provenance', 'Provider provenance', 'soft', true, 'Provider/model should be visible', `${message.provider || 'system'} / ${message.modelName || 'none'}`, fallbackUsed),
        ],
    });
}
export function validateCustomerSupportDraft(executionId, resourceId, draftMessage, fallbackUsed, unsafeDetected) {
    return buildValidationRun({
        agentId: 'customer_support',
        executionId,
        resourceType: 'customer_chat',
        resourceId,
        fallbackUsed,
        validatorResults: [
            makeValidator('safe-content', 'Safe support content', 'hard', !unsafeDetected, 'No refund/return promise or unsupported claim', unsafeDetected ? draftMessage : 'No unsafe patterns detected'),
            makeValidator('fallback-draft', 'Fallback draft warning', 'soft', true, 'Direct provider-generated answer preferred', fallbackUsed ? 'Template or fallback draft used' : 'Provider-generated support draft', fallbackUsed),
        ],
    });
}
export function getAgentContract(state, agentId) {
    return state.agentContracts.find((contract) => contract.agentId === agentId) || null;
}
export function findLatestValidationForExecution(state, executionId) {
    return state.validationRuns.find((run) => run.executionId === executionId) || null;
}
