export type AutomationMode = 'SANDBOX' | 'APPROVAL_REQUIRED' | 'AUTO_PUBLISH' | 'PAUSED';
export type CandidateStatus = 'DISCOVERED' | 'IGNORED' | 'TEST_ONLY' | 'READY_TO_LIST' | 'BLOCKED';
export type DraftStatus = 'DRAFT_READY' | 'APPROVED' | 'REJECTED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'ROLLED_BACK';
export type JobStatus = 'queued' | 'running' | 'retryable' | 'completed' | 'failed';
export type JobType =
  | 'discovery'
  | 'publish_listing'
  | 'sync_orders'
  | 'sync_inventory'
  | 'order_push'
  | 'support_reply'
  | 'rollback_inventory'
  | 'rollback_offer';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type FulfillmentStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'FULFILLMENT_REVIEW_REQUIRED'
  | 'QUEUED_FOR_PUSH'
  | 'PLACED'
  | 'TRACKING_POSTED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'REFUND_RISK';
export type RiskClass = 'low' | 'medium' | 'high';
export type ProviderName = 'ebay' | 'cj' | 'deepseek' | 'gemini' | 'system';
export type PolicyState = 'clear' | 'review' | 'blocked';
export type SupportThreadState = 'open' | 'waiting' | 'resolved' | 'escalated';

export interface AutomationSettings {
  automationMode: AutomationMode;
  publishingEnabled: boolean;
  orderPushEnabled: boolean;
  supportAutoSend: boolean;
  approvalWindowEndsAt: string;
  sandboxStartedAt: string;
  sandboxEndsAt: string;
  lastDiscoveryRunAt: string | null;
  lastInventorySyncAt: string | null;
  lastOrderSyncAt: string | null;
}

export interface CostBudget {
  monthlyCapUsd: number;
  dailyCapUsd: number;
  monthToDateUsd: number;
  dayToDateUsd: number;
  currentMonth: string;
  currentDay: string;
  aiFallbackMode: boolean;
}

export interface PlatformConnection {
  name: string;
  status: 'connected' | 'disconnected' | 'sandbox' | 'degraded';
  lastCheckedAt: string | null;
  notes?: string;
}

export interface CJProduct {
  id: string;
  variantId: string;
  title: string;
  normalizedKeyword: string;
  categoryPath: string;
  warehouseCountry: string;
  landedCost: number;
  shippingCost: number;
  stock: number;
  estimatedDeliveryBusinessDays: number;
  supplierName: string;
  supplierAgeDays: number;
  shippingConsistency: number;
  stockStability: number;
  orderHistoryScore: number;
  imageUrl: string;
  tags: string[];
}

export interface MarketSearchSnapshot {
  sold30d: number;
  sold7d: number;
  uniqueSellers30d: number;
  medianSoldPrice30d: number;
  activeCount: number;
  topRatedCount: number;
  eliteShare: number;
  competitionRatio: number;
  capturedAt: string;
}

export interface ScoreBreakdown {
  demandScore: number;
  shippingSpeedScore: number;
  profitMarginScore: number;
  returnRiskScore: number;
  competitionScore: number;
  supplierReliabilityScore: number;
  policyRiskScore: number;
  listingComplexityScore: number;
  totalScore: number;
  decision: Extract<CandidateStatus, 'IGNORED' | 'TEST_ONLY' | 'READY_TO_LIST' | 'BLOCKED'>;
  hardRejectReasons: string[];
  netMarginPercent: number;
}

export interface ProductCandidate {
  id: string;
  sourceFingerprint: string;
  sellerSku: string;
  cjProductId: string;
  cjVariantId: string;
  title: string;
  normalizedKeyword: string;
  categoryPath: string;
  warehouseCountry: string;
  landedCost: number;
  shippingCost: number;
  stock: number;
  estimatedDeliveryBusinessDays: number;
  supplierName: string;
  imageUrl: string;
  tags: string[];
  targetPrice: number;
  status: CandidateStatus;
  policyState: PolicyState;
  riskClass: RiskClass;
  marketplace: 'EBAY_US';
  managedBySystem: boolean;
  searchSnapshot: MarketSearchSnapshot | null;
  scoreBreakdown: ScoreBreakdown | null;
  policyMatches: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListingDraft {
  id: string;
  candidateId: string;
  marketplace: 'EBAY_US';
  sellerSku: string;
  title: string;
  subtitle?: string;
  description: string;
  bullets: string[];
  itemSpecifics: Record<string, string>;
  images: string[];
  price: number;
  quantity: number;
  warningMessages: string[];
  status: DraftStatus;
  approvalRequired: boolean;
  publishedAt: string | null;
  ebayInventoryItemId: string | null;
  ebayOfferId: string | null;
  offerCategoryId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuyerAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
}

export interface OrderRecord {
  id: string;
  ebayOrderId: string;
  draftId: string;
  sellerSku: string;
  buyerUserId: string;
  orderTotalUsd: number;
  quantity: number;
  destinationCountry: string;
  address: BuyerAddress;
  fulfillmentStatus: FulfillmentStatus;
  riskClass: RiskClass;
  trackingNumber: string | null;
  carrier: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FulfillmentJob {
  id: string;
  orderId: string;
  idempotencyKey: string;
  cjOrderId: string | null;
  status: 'PENDING' | 'PLACED' | 'FAILED' | 'MANUAL_REVIEW';
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeadLetter {
  id: string;
  jobId: string | null;
  resourceType: string;
  resourceId: string;
  stage: string;
  provider: ProviderName;
  errorClass: string;
  payloadSnapshot: string;
  attemptCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface SystemAlert {
  id: string;
  code: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  context: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportThread {
  id: string;
  orderId: string | null;
  subject: string;
  buyerUserId: string;
  state: SupportThreadState;
  priority: 'low' | 'medium' | 'high';
  latestMessage: string;
  autoSendEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  jobType: JobType;
  status: 'running' | 'completed' | 'failed';
  summary: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface AuditLog {
  id: string;
  action: string;
  actor: string;
  summary: string;
  createdAt: string;
}

export interface AIArtifactCacheEntry {
  id: string;
  productFingerprint: string;
  kind: 'listing_pack' | 'support_draft';
  provider: ProviderName;
  payload: string;
  expiresAt: string;
  createdAt: string;
}

export interface ProhibitedRule {
  id: string;
  keyword: string;
  category: string;
  severity: 'block' | 'review';
  reason: string;
}

export interface VeroRule {
  id: string;
  brand: string;
  keyword: string;
  pattern: string;
  reason: string;
  severity: 'block' | 'review';
}

export interface WorkerJob {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  attemptCount: number;
  nextAttemptAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  settings: AutomationSettings;
  budgets: CostBudget;
  connections: PlatformConnection[];
  prohibitedRules: ProhibitedRule[];
  veroBlocklist: VeroRule[];
  candidates: ProductCandidate[];
  listingDrafts: ListingDraft[];
  orders: OrderRecord[];
  fulfillmentJobs: FulfillmentJob[];
  deadLetters: DeadLetter[];
  alerts: SystemAlert[];
  supportThreads: SupportThread[];
  agentRuns: AgentRun[];
  auditLogs: AuditLog[];
  aiCache: AIArtifactCacheEntry[];
}

export interface DashboardPayload {
  generatedAt: string;
  settings: AutomationSettings;
  budgets: CostBudget;
  connections: PlatformConnection[];
  stats: {
    totalCandidates: number;
    readyToList: number;
    pendingApprovals: number;
    publishedListings: number;
    openAlerts: number;
    deadLetters: number;
    autoPushEligibleOrders: number;
  };
  candidates: ProductCandidate[];
  listingDrafts: ListingDraft[];
  alerts: SystemAlert[];
  deadLetters: DeadLetter[];
  supportThreads: SupportThread[];
  recentRuns: AgentRun[];
  auditLogs: AuditLog[];
}

export interface RuntimeConfig {
  port: number;
  nodeEnv: string;
  appBaseUrl: string;
  storageDriver: 'file' | 'postgres';
  databaseUrl: string | null;
  dataFilePath: string;
  workerPollMs: number;
  sessionSecret: string;
  alertEmail: string | null;
  ebay: {
    env: 'sandbox' | 'production';
    clientId: string | null;
    clientSecret: string | null;
    redirectUri: string | null;
    sandboxClientId: string | null;
    sandboxClientSecret: string | null;
    sandboxRedirectUri: string | null;
    marketplaceId: 'EBAY_US';
  };
  cj: {
    apiBaseUrl: string;
    apiKey: string | null;
    accessToken: string | null;
    requestsPerSecond: number;
    scanLimit: number;
  };
  ai: {
    deepseekApiKey: string | null;
    deepseekModel: string;
    geminiApiKey: string | null;
    geminiModel: string;
    monthlyCapUsd: number;
    dailyCapUsd: number;
  };
  sentryDsn: string | null;
}

export interface ListingPack {
  title: string;
  subtitle?: string;
  description: string;
  bullets: string[];
  itemSpecifics: Record<string, string>;
  images: string[];
}
