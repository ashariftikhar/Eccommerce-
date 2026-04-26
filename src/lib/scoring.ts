import { CJProduct, MarketSearchSnapshot, ScoreBreakdown } from '../types';
import { clamp, round } from './utils';

function demandScore(snapshot: MarketSearchSnapshot): number {
  return Math.round(
    100 *
      (0.5 * Math.min(1, snapshot.sold30d / 80) +
        0.3 * Math.min(1, snapshot.sold7d / 20) +
        0.2 * Math.min(1, snapshot.uniqueSellers30d / 15)),
  );
}

function competitionScore(snapshot: MarketSearchSnapshot): number {
  return clamp(
    Math.round(100 * (1 - Math.min(3, snapshot.competitionRatio) / 3) * (1 - 0.5 * snapshot.eliteShare)),
    0,
    100,
  );
}

function shippingSpeedScore(eta: number): number {
  if (eta <= 3) {
    return 100;
  }
  if (eta <= 5) {
    return 80;
  }
  if (eta <= 7) {
    return 50;
  }
  return 0;
}

function returnRiskScore(product: CJProduct): number {
  const haystack = `${product.title} ${product.categoryPath} ${product.tags.join(' ')}`.toLowerCase();
  let score = 100;
  const penalties: Array<[RegExp, number]> = [
    [/\bglass|ceramic|fragile\b/, 35],
    [/\belectronic|charger|adapter|smart\b/, 20],
    [/\bsize|sizing|apparel|shoe\b/, 35],
    [/\bcompatible|fitment|mount\b/, 25],
    [/\bliquid|gel|serum\b/, 30],
    [/\bbattery|power bank\b/, 25],
  ];

  for (const [pattern, penalty] of penalties) {
    if (pattern.test(haystack)) {
      score -= penalty;
    }
  }

  return clamp(score, 0, 100);
}

function supplierReliabilityScore(product: CJProduct): number {
  const supplierAgeScore = Math.min(100, product.supplierAgeDays / 7);
  return round(
    clamp(
      supplierAgeScore * 0.2 + product.shippingConsistency * 0.35 + product.stockStability * 0.2 + product.orderHistoryScore * 0.25,
      0,
      100,
    ),
    0,
  );
}

function listingComplexityScore(product: CJProduct): number {
  const haystack = `${product.title} ${product.categoryPath} ${product.tags.join(' ')}`.toLowerCase();
  let score = 100;
  const penalties: Array<[RegExp, number]> = [
    [/\bset of\b/, 10],
    [/\bvariant|color|size\b/, 35],
    [/\binstallation|compatible|fitment\b/, 25],
    [/\bfragile|glass\b/, 15],
  ];

  for (const [pattern, penalty] of penalties) {
    if (pattern.test(haystack)) {
      score -= penalty;
    }
  }

  return clamp(score, 0, 100);
}

function priceForMargin(product: CJProduct): number {
  const target = product.landedCost <= 6 ? 17.99 : product.landedCost <= 8 ? 19.99 : 22.99;
  return round(target, 2);
}

export function scoreCandidate(args: {
  product: CJProduct;
  snapshot: MarketSearchSnapshot;
  policyState: 'clear' | 'review' | 'blocked';
  hardRejectReasons?: string[];
}): ScoreBreakdown & { targetPrice: number } {
  const targetPrice = priceForMargin(args.product);
  const ebayFees = targetPrice * 0.15;
  const netMarginPercent = ((targetPrice - args.product.landedCost - ebayFees) / targetPrice) * 100;

  const hardRejectReasons = [...(args.hardRejectReasons || [])];
  if (args.product.warehouseCountry !== 'US') {
    hardRejectReasons.push('Warehouse is not US-based.');
  }
  if (args.product.estimatedDeliveryBusinessDays > 7) {
    hardRejectReasons.push('Estimated delivery exceeds 7 business days.');
  }
  if (netMarginPercent < 25) {
    hardRejectReasons.push('Net margin below 25%.');
  }
  if (args.policyState === 'blocked') {
    hardRejectReasons.push('Blocked by policy engine.');
  }

  const demand = demandScore(args.snapshot);
  const shipping = shippingSpeedScore(args.product.estimatedDeliveryBusinessDays);
  const margin = clamp(Math.round((netMarginPercent / 35) * 100), 0, 100);
  const returns = returnRiskScore(args.product);
  const competition = competitionScore(args.snapshot);
  const reliability = supplierReliabilityScore(args.product);
  const policy = args.policyState === 'clear' ? 100 : args.policyState === 'review' ? 45 : 0;
  const complexity = listingComplexityScore(args.product);

  const totalScore = round(
    demand * 0.22 +
      shipping * 0.18 +
      margin * 0.2 +
      competition * 0.1 +
      reliability * 0.1 +
      returns * 0.1 +
      policy * 0.05 +
      complexity * 0.05,
    0,
  );

  let decision: ScoreBreakdown['decision'] = 'IGNORED';
  if (hardRejectReasons.length > 0) {
    decision = 'BLOCKED';
  } else if (totalScore >= 85) {
    decision = 'READY_TO_LIST';
  } else if (totalScore >= 70) {
    decision = 'TEST_ONLY';
  }

  return {
    demandScore: demand,
    shippingSpeedScore: shipping,
    profitMarginScore: margin,
    returnRiskScore: returns,
    competitionScore: competition,
    supplierReliabilityScore: reliability,
    policyRiskScore: policy,
    listingComplexityScore: complexity,
    totalScore,
    decision,
    hardRejectReasons,
    netMarginPercent: round(netMarginPercent, 2),
    targetPrice,
  };
}
