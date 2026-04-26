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
export type AgentStatus = 'running' | 'idle' | 'watching' | 'blocked';
export type AgentExecutionStatus = 'running' | 'completed' | 'failed';
export type ValidationSeverity = 'hard' | 'soft';
export type ValidationStatus = 'passed' | 'warning' | 'failed';
export type AgentId =
  | 'trend_discovery'
  | 'cj_match'
  | 'product_scoring'
  | 'listing_generator'
  | 'ebay_publisher'
  | 'fulfillment'
  | 'customer_support'
  | 'supplier_liaison'
  | 'manager';

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
  linkedExecutionIds?: string[];
  linkedValidationIds?: string[];
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
  linkedExecutionIds?: string[];
  linkedValidationIds?: string[];
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
  linkedExecutionIds?: string[];
  linkedValidationIds?: string[];
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
  linkedExecutionIds?: string[];
  linkedValidationIds?: string[];
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

export interface ConversationMessage {
  id: string;
  sender: 'owner' | 'supplier' | 'customer' | 'ceo' | 'system' | 'agent';
  direction: 'inbound' | 'outbound' | 'internal';
  message: string;
  createdAt: string;
  provider?: ProviderName;
  modelName?: string | null;
  linkedExecutionId?: string | null;
}

export interface SupplierConversation {
  id: string;
  supplierName: string;
  supplierRegion: string;
  sellerSku: string;
  productTitle: string;
  status: 'online' | 'awaiting_reply' | 'issue' | 'resolved';
  topic: string;
  lastMessage: string;
  lastMessageAt: string;
  responseEtaHours: number;
  messages: ConversationMessage[];
  linkedExecutionIds?: string[];
  linkedValidationIds?: string[];
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  purpose: string;
  providerPreference: ProviderName[];
  allowedActions: string[];
}

export interface AgentContract {
  agentId: AgentId;
  role: string;
  inputs: string[];
  outputs: string[];
  hardValidators: string[];
  softValidators: string[];
  handoffTargets: string[];
  fallbackBehavior: string;
  refinementBehavior: string;
  blockingFailureBehavior: string;
  optimizationNotes: string[];
}

export interface AgentExecutionStep {
  id: string;
  executionId: string;
  stepName: string;
  provider: ProviderName;
  modelName: string | null;
  requestPurpose: string;
  inputSummary: string;
  outputSummary: string;
  durationMs: number;
  success: boolean;
  error: string | null;
  createdAt: string;
}

export interface AgentExecution {
  id: string;
  agentId: AgentId;
  status: AgentExecutionStatus;
  triggerSource: string;
  parentJobId: string | null;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
  linkedResourceType: string | null;
  linkedResourceId: string | null;
  validationRunIds: string[];
  steps: AgentExecutionStep[];
}

export interface ValidatorResult {
  validatorId: string;
  name: string;
  severity: ValidationSeverity;
  status: ValidationStatus;
  message: string;
  expected: string;
  observed: string;
}

export interface ValidationRun {
  id: string;
  agentId: AgentId;
  executionId: string;
  resourceType: string;
  resourceId: string;
  status: ValidationStatus;
  blocking: boolean;
  score: number;
  refinementCount: number;
  simulatedData: boolean;
  fallbackUsed: boolean;
  validatorResults: ValidatorResult[];
  createdAt: string;
  updatedAt: string;
}

export interface ImportedListingRecord {
  id: string;
  sellerSku: string;
  title: string;
  marketplace: 'EBAY_US';
  listingState: 'draft' | 'published' | 'ended';
  historicalImport: boolean;
  external: boolean;
  matchedCandidateId: string | null;
  matchedDraftId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportedCustomerConversation {
  id: string;
  subject: string;
  buyerUserId: string;
  historicalImport: boolean;
  matchedOrderId: string | null;
  linkedExecutionIds: string[];
  linkedValidationIds: string[];
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ImportedOrderLink {
  id: string;
  ebayOrderId: string;
  sellerSku: string;
  historicalImport: boolean;
  linkedLocalOrderId: string | null;
  state: FulfillmentStatus;
  orderTotalUsd: number;
  createdAt: string;
}

export interface CeoChatThread {
  scope: 'last_90_days';
  messages: ConversationMessage[];
}

export interface AgentStatusCard {
  id: AgentId;
  name: string;
  role: string;
  stage: string;
  status: AgentStatus;
  currentTask: string;
  queueDepth: number;
  successRate: number;
  lastHeartbeatAt: string;
}

export interface StoreOverview {
  id: string;
  name: string;
  platform: string;
  status: 'connected' | 'sandbox' | 'watch' | 'risk';
  totalListings: number;
  publishedListings: number;
  pendingApprovals: number;
  ordersToday: number;
  grossRevenueUsd: number;
  accountHealth: 'healthy' | 'watch' | 'risk';
  note: string;
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
  supplierChats: SupplierConversation[];
  customerChats: ImportedCustomerConversation[];
  ceoChat: CeoChatThread;
  importedListings: ImportedListingRecord[];
  importedOrders: ImportedOrderLink[];
  agentDefinitions: AgentDefinition[];
  agentContracts: AgentContract[];
  agentExecutions: AgentExecution[];
  validationRuns: ValidationRun[];
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
  agentFleet: AgentStatusCard[];
  storeOverview: StoreOverview[];
  supplierChats: SupplierConversation[];
  recentRuns: AgentRun[];
  auditLogs: AuditLog[];
}

export interface OverviewPayload {
  generatedAt: string;
  settings: AutomationSettings;
  budgets: CostBudget;
  connections: PlatformConnection[];
  stats: DashboardPayload['stats'];
  alerts: SystemAlert[];
  storeOverview: StoreOverview[];
}

export interface AgentsPayload {
  generatedAt: string;
  definitions: AgentDefinition[];
  fleet: AgentStatusCard[];
  executions: AgentExecution[];
  recentRuns: AgentRun[];
}

export interface StorePayload {
  generatedAt: string;
  connections: PlatformConnection[];
  storeOverview: StoreOverview[];
  settings: AutomationSettings;
  alerts: SystemAlert[];
  readinessChecklist: Array<{ id: string; label: string; done: boolean; note: string }>;
}

export interface InventoryPayload {
  generatedAt: string;
  candidates: ProductCandidate[];
  drafts: ListingDraft[];
  published: ListingDraft[];
  blocked: ProductCandidate[];
  importedListings: ImportedListingRecord[];
}

export interface OrdersPayload {
  generatedAt: string;
  orders: OrderRecord[];
  fulfillmentJobs: FulfillmentJob[];
  importedOrders: ImportedOrderLink[];
}

export interface SupplierChatsPayload {
  generatedAt: string;
  chats: SupplierConversation[];
}

export interface CustomerChatsPayload {
  generatedAt: string;
  connected: boolean;
  importScopeDays: 90;
  waitingReason: string | null;
  conversations: ImportedCustomerConversation[];
}

export interface CeoChatPayload {
  generatedAt: string;
  thread: CeoChatThread;
}

export interface ArchitecturePayload {
  generatedAt: string;
  flowchart: string;
  contracts: AgentContract[];
  routingRules: string[];
  failureMatrix: Array<{ id: string; stage: string; failure: string; handling: string }>;
  validationSummary: Array<{ agentId: AgentId; passed: number; warning: number; failed: number }>;
}

export interface ValidationPayload {
  generatedAt: string;
  stats: {
    passed: number;
    warnings: number;
    failed: number;
    fallbackRuns: number;
    simulatedRuns: number;
  };
  runs: ValidationRun[];
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
