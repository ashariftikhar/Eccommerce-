import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import { nowIso, createId } from './utils';
import { seedProhibitedRules, seedVeroRules } from './policy';
const SNAPSHOT_KEY = 'primary';
function currentMonth() {
    return new Date().toISOString().slice(0, 7);
}
function currentDay() {
    return new Date().toISOString().slice(0, 10);
}
function createDefaultSettings() {
    const now = new Date();
    const sandboxEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const approvalWindowEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return {
        automationMode: 'SANDBOX',
        publishingEnabled: false,
        orderPushEnabled: false,
        supportAutoSend: false,
        sandboxStartedAt: now.toISOString(),
        sandboxEndsAt: sandboxEndsAt.toISOString(),
        approvalWindowEndsAt: approvalWindowEndsAt.toISOString(),
        lastDiscoveryRunAt: null,
        lastInventorySyncAt: null,
        lastOrderSyncAt: null,
    };
}
function createDefaultBudgets(config) {
    return {
        monthlyCapUsd: config.ai.monthlyCapUsd,
        dailyCapUsd: config.ai.dailyCapUsd,
        monthToDateUsd: 0,
        dayToDateUsd: 0,
        currentMonth: currentMonth(),
        currentDay: currentDay(),
        aiFallbackMode: false,
    };
}
function createDefaultConnections(config) {
    return [
        {
            name: 'eBay',
            status: config.ebay.env === 'sandbox' ? 'sandbox' : 'degraded',
            lastCheckedAt: null,
            notes: config.ebay.clientId || config.ebay.sandboxClientId ? 'Credentials detected. Historical import will unlock after seller OAuth.' : 'Missing seller OAuth credentials.',
        },
        {
            name: 'CJdropshipping',
            status: config.cj.accessToken ? 'connected' : 'degraded',
            lastCheckedAt: null,
            notes: config.cj.accessToken ? 'Real CJ catalog discovery is enabled.' : 'Synthetic catalog fallback is active until CJ access token is configured.',
        },
        {
            name: 'DeepSeek',
            status: config.ai.deepseekApiKey ? 'connected' : 'degraded',
            lastCheckedAt: null,
            notes: config.ai.deepseekApiKey ? `Primary bulk model: ${config.ai.deepseekModel}` : 'Template fallback only until DeepSeek API key is added.',
        },
        {
            name: 'Gemini',
            status: config.ai.geminiApiKey ? 'connected' : 'degraded',
            lastCheckedAt: null,
            notes: config.ai.geminiApiKey ? `Tie-break and escalation model: ${config.ai.geminiModel}` : 'Fallback disabled until Gemini API key is added.',
        },
        {
            name: 'Supabase / Postgres',
            status: config.storageDriver === 'postgres' ? 'connected' : 'degraded',
            lastCheckedAt: null,
            notes: config.storageDriver === 'postgres' ? 'Production persistence is active.' : 'File storage is active. Connect Supabase Postgres for production persistence.',
        },
    ];
}
function createDefaultAlerts(config) {
    const alerts = [];
    if (!config.cj.accessToken || !config.cj.apiKey) {
        alerts.push({
            id: createId('alert'),
            code: 'CJ_API_DEGRADED',
            severity: 'warning',
            status: 'open',
            message: 'CJ API credentials are missing or incomplete.',
            context: 'Discovery runs will fall back to synthetic catalog data until CJ API access is configured.',
            createdAt: nowIso(),
            updatedAt: nowIso(),
        });
    }
    if (!config.ebay.clientId && !config.ebay.sandboxClientId) {
        alerts.push({
            id: createId('alert'),
            code: 'EBAY_OAUTH_BROKEN',
            severity: 'warning',
            status: 'open',
            message: 'eBay app credentials are not configured.',
            context: 'Marketplace scoring and publish actions are running in simulation mode.',
            createdAt: nowIso(),
            updatedAt: nowIso(),
        });
    }
    return alerts;
}
function createDefaultAgentDefinitions() {
    return [
        {
            id: 'trend_discovery',
            name: 'Trend Discovery Agent',
            purpose: 'Finds high-potential utility products and trends worth validating.',
            providerPreference: ['system', 'cj', 'ebay'],
            allowedActions: ['scan_catalog', 'normalize_keywords', 'queue_candidates'],
        },
        {
            id: 'cj_match',
            name: 'CJ Match Agent',
            purpose: 'Matches promising ideas to CJ US-warehouse products and stock.',
            providerPreference: ['cj', 'system'],
            allowedActions: ['prefilter_us_warehouse', 'stock_check', 'supplier_match'],
        },
        {
            id: 'product_scoring',
            name: 'Product Scoring Engine',
            purpose: 'Scores demand, margin, competition, policy, and complexity.',
            providerPreference: ['ebay', 'system'],
            allowedActions: ['score_candidate', 'reject_candidate', 'promote_candidate'],
        },
        {
            id: 'listing_generator',
            name: 'Listing Generator Agent',
            purpose: 'Creates titles, bullets, descriptions, and item specifics.',
            providerPreference: ['deepseek', 'gemini', 'system'],
            allowedActions: ['generate_listing_pack', 'cache_listing_pack'],
        },
        {
            id: 'ebay_publisher',
            name: 'eBay Listing Publisher',
            purpose: 'Handles inventory draft creation, offer publishing, and rollback.',
            providerPreference: ['ebay', 'system'],
            allowedActions: ['draft_listing', 'publish_listing', 'rollback_listing'],
        },
        {
            id: 'fulfillment',
            name: 'Fulfillment Agent',
            purpose: 'Pushes low-risk orders to CJ and tracks placement state.',
            providerPreference: ['cj', 'system'],
            allowedActions: ['evaluate_low_risk', 'place_cj_order', 'flag_manual_review'],
        },
        {
            id: 'customer_support',
            name: 'Customer Support Agent',
            purpose: 'Summarizes customer issues and drafts safe responses.',
            providerPreference: ['deepseek', 'gemini', 'system'],
            allowedActions: ['summarize_thread', 'draft_status_update', 'escalate_issue'],
        },
        {
            id: 'supplier_liaison',
            name: 'Supplier Liaison Agent',
            purpose: 'Tracks supplier commitments, issues, and follow-ups.',
            providerPreference: ['system', 'cj'],
            allowedActions: ['simulate_follow_up', 'log_supplier_reply', 'mark_issue'],
        },
        {
            id: 'manager',
            name: 'Manager Agent',
            purpose: 'Monitors risk, budget, and explains what the system is doing.',
            providerPreference: ['deepseek', 'gemini', 'system'],
            allowedActions: ['summarize_state', 'answer_ceo_chat', 'trigger_kill_switch'],
        },
    ];
}
function createDefaultAgentContracts() {
    return [
        {
            agentId: 'trend_discovery',
            role: 'Scans candidate catalog inputs and produces discovery candidates.',
            inputs: ['CJ catalog feed', 'stored blocklists', 'system scan limits'],
            outputs: ['candidate batch', 'normalized keywords', 'catalog source mode'],
            hardValidators: ['catalog availability'],
            softValidators: ['candidate count threshold', 'synthetic-only source warning', 'repetitive pool detection'],
            handoffTargets: ['cj_match'],
            fallbackBehavior: 'Use synthetic catalog only when CJ is unavailable and label the run as simulated.',
            refinementBehavior: 'Rerun discovery with updated supplier or scan settings.',
            blockingFailureBehavior: 'Block downstream discovery if no candidate pool can be produced.',
            optimizationNotes: ['Cache repeated discovery keywords', 'sample warnings once pool quality stabilizes'],
        },
        {
            agentId: 'cj_match',
            role: 'Filters discovery candidates into US-warehouse, in-stock supplier matches.',
            inputs: ['discovery candidates', 'supplier stock and ETA', 'cost and policy baseline'],
            outputs: ['qualified candidate', 'prefilter reasons', 'supplier readiness'],
            hardValidators: ['US warehouse', 'stock threshold', 'ETA threshold', 'landed cost present', 'supplier identity present'],
            softValidators: ['supplier issue watch', 'simulated supplier data warning'],
            handoffTargets: ['product_scoring', 'supplier_liaison'],
            fallbackBehavior: 'Use cached/synthetic stock estimates only when CJ is disconnected and mark output as simulated.',
            refinementBehavior: 'Retry supplier match after stock or ETA refresh.',
            blockingFailureBehavior: 'Mark candidate blocked and stop scoring handoff.',
            optimizationNotes: ['Avoid rematching unchanged products', 'batch supplier lookups by normalized keyword'],
        },
        {
            agentId: 'product_scoring',
            role: 'Scores candidates across demand, competition, margin, risk, and policy.',
            inputs: ['qualified candidate', 'market snapshot', 'policy evaluation'],
            outputs: ['score breakdown', 'decision', 'hard reject reasons'],
            hardValidators: ['score breakdown complete', 'decision present', 'total score in range', 'decision consistent with reject reasons'],
            softValidators: ['simulated eBay market data warning'],
            handoffTargets: ['listing_generator', 'manager'],
            fallbackBehavior: 'Use simulated market data only when eBay market APIs are unavailable.',
            refinementBehavior: 'Rerun scoring after refreshed market snapshot or policy changes.',
            blockingFailureBehavior: 'Move candidate to validation review / blocked state.',
            optimizationNotes: ['Revalidate only when candidate fingerprint or snapshot changes'],
        },
        {
            agentId: 'listing_generator',
            role: 'Produces listing packs and draft listings for scored candidates.',
            inputs: ['score-qualified candidate', 'policy warnings', 'provider budget state'],
            outputs: ['listing pack', 'draft listing', 'generation provenance'],
            hardValidators: ['title present', 'description present', 'item specifics present', 'price present', 'images present'],
            softValidators: ['template fallback warning', 'provider downgrade warning', 'category policy warning'],
            handoffTargets: ['ebay_publisher', 'manager'],
            fallbackBehavior: 'Use deterministic template pack when AI budget or providers are unavailable.',
            refinementBehavior: 'Regenerate once, then block and surface for review.',
            blockingFailureBehavior: 'Do not create or route invalid drafts downstream.',
            optimizationNotes: ['Cache listing packs by product fingerprint for 30 days'],
        },
        {
            agentId: 'ebay_publisher',
            role: 'Creates inventory items, publishes offers, and handles rollback.',
            inputs: ['approved draft', 'publish settings', 'marketplace state'],
            outputs: ['inventory item', 'offer publish result', 'rollback state'],
            hardValidators: ['inventory item created', 'offer publish succeeded', 'duplicate SKU prevented'],
            softValidators: ['sandbox/simulated publish warning'],
            handoffTargets: ['fulfillment', 'customer_support', 'manager'],
            fallbackBehavior: 'Stay in sandbox/simulated publish mode until production credentials are live.',
            refinementBehavior: 'Retry publish after metadata correction or approval review.',
            blockingFailureBehavior: 'Fail publish, alert manager, and preserve rollback path.',
            optimizationNotes: ['Reuse SKU-based idempotency checks before publish'],
        },
        {
            agentId: 'fulfillment',
            role: 'Evaluates low-risk orders and pushes eligible ones to CJ.',
            inputs: ['paid order', 'candidate linkage', 'low-risk rules', 'CJ access'],
            outputs: ['manual review decision', 'CJ order placement', 'fulfillment job state'],
            hardValidators: ['idempotency key present', 'candidate/draft/order linkage valid', 'CJ placement success'],
            softValidators: ['manual review warning when low-risk rules fail'],
            handoffTargets: ['manager'],
            fallbackBehavior: 'Downgrade to manual review whenever CJ access or low-risk validation is not satisfied.',
            refinementBehavior: 'Retry after address, stock, or linkage correction.',
            blockingFailureBehavior: 'Do not place order and mark fulfillment for review.',
            optimizationNotes: ['Persist idempotency keys before any provider call'],
        },
        {
            agentId: 'customer_support',
            role: 'Drafts safe informational support responses and escalates risky ones.',
            inputs: ['support thread', 'order context', 'policy safety rules'],
            outputs: ['reply draft', 'escalation state'],
            hardValidators: ['no unsafe refund/return promise', 'no unsupported automated claim'],
            softValidators: ['template fallback warning', 'draft-only downgrade warning'],
            handoffTargets: ['manager'],
            fallbackBehavior: 'Draft-only mode when ambiguity or policy sensitivity is detected.',
            refinementBehavior: 'Request manual clarification and regenerate summary.',
            blockingFailureBehavior: 'Block auto-send and escalate thread.',
            optimizationNotes: ['Reuse safe informational templates for shipment/status updates'],
        },
        {
            agentId: 'supplier_liaison',
            role: 'Coordinates supplier follow-ups, commitments, and issue status.',
            inputs: ['supplier thread', 'owner follow-up', 'reply ETA policy'],
            outputs: ['thread update', 'supplier acknowledgment', 'issue status'],
            hardValidators: ['thread exists'],
            softValidators: ['reply ETA exceeded warning', 'simulated reply warning'],
            handoffTargets: ['manager'],
            fallbackBehavior: 'Use simulated internal acknowledgment until live supplier chat hooks exist.',
            refinementBehavior: 'Trigger another follow-up after ETA threshold.',
            blockingFailureBehavior: 'Escalate unresolved supplier issues to manager.',
            optimizationNotes: ['Collapse duplicate follow-ups into a single thread action'],
        },
        {
            agentId: 'manager',
            role: 'Explains system state, recommends actions, and manages controls.',
            inputs: ['cross-agent traces', 'alerts', 'chat prompts', 'budget state'],
            outputs: ['narrative summary', 'advisory recommendation', 'control action'],
            hardValidators: ['linked traces present when recommendation is produced'],
            softValidators: ['provider/model provenance', 'system fallback warning'],
            handoffTargets: ['owner'],
            fallbackBehavior: 'Use system narrative when AI providers are unavailable.',
            refinementBehavior: 'Regenerate summary with updated state or escalations.',
            blockingFailureBehavior: 'Never blocks pipeline directly; raises alert instead.',
            optimizationNotes: ['Prefer concise summaries and reuse latest state snapshot'],
        },
    ];
}
function createMessage(sender, direction, message, provider, modelName) {
    return {
        id: createId('msg'),
        sender,
        direction,
        message,
        createdAt: nowIso(),
        provider,
        modelName: modelName ?? null,
        linkedExecutionId: null,
    };
}
function createDefaultSupplierChats() {
    return [
        {
            id: createId('supplier'),
            supplierName: 'CJ US Home Utility Hub',
            supplierRegion: 'California, US',
            sellerSku: 'YZG-PENDING',
            productTitle: 'US Warehouse Candidate Pool',
            status: 'online',
            topic: 'Stock commitment for fast-moving utility SKUs',
            lastMessage: 'We can hold same-day dispatch inventory once your weekly volume stabilizes.',
            lastMessageAt: nowIso(),
            responseEtaHours: 2,
            messages: [
                createMessage('supplier', 'inbound', 'We can hold same-day dispatch inventory once your weekly volume stabilizes.', 'cj', null),
                createMessage('agent', 'internal', 'Supplier Liaison Agent marked this thread as ready for a volume follow-up.', 'system', null),
            ],
            linkedExecutionIds: [],
        },
        {
            id: createId('supplier'),
            supplierName: 'CJ Personal Care Warehouse',
            supplierRegion: 'New Jersey, US',
            sellerSku: 'YZG-PENDING',
            productTitle: 'Beauty / Personal Care shortlist',
            status: 'awaiting_reply',
            topic: 'Confirm packaging, lot consistency, and 5-day delivery SLA',
            lastMessage: 'Awaiting reply on packaging photos and replacement handling.',
            lastMessageAt: nowIso(),
            responseEtaHours: 6,
            messages: [
                createMessage('owner', 'outbound', 'Please confirm packaging photos, lot consistency, and replacement handling for US dispatch.'),
                createMessage('agent', 'internal', 'Supplier Liaison Agent is watching this thread and will surface delays.', 'system', null),
            ],
            linkedExecutionIds: [],
        },
    ];
}
function createDefaultCustomerChats() {
    return [];
}
function createDefaultCeoChat() {
    return {
        scope: 'last_90_days',
        messages: [
            createMessage('system', 'internal', 'CEO Chat is active. Before eBay is connected, this view explains internal operations, simulated market steps, and readiness blockers.', 'system', null),
            createMessage('ceo', 'outbound', 'Focus on visibility first: watch discovery, review supplier commitments, and confirm AI/provider routing before enabling auto-publish.', 'system', null),
        ],
    };
}
export function createDefaultState(config) {
    return {
        settings: createDefaultSettings(),
        budgets: createDefaultBudgets(config),
        connections: createDefaultConnections(config),
        prohibitedRules: seedProhibitedRules(),
        veroBlocklist: seedVeroRules(),
        candidates: [],
        listingDrafts: [],
        orders: [],
        fulfillmentJobs: [],
        deadLetters: [],
        alerts: createDefaultAlerts(config),
        supportThreads: [],
        supplierChats: createDefaultSupplierChats(),
        customerChats: createDefaultCustomerChats(),
        ceoChat: createDefaultCeoChat(),
        importedListings: [],
        importedOrders: [],
        agentDefinitions: createDefaultAgentDefinitions(),
        agentContracts: createDefaultAgentContracts(),
        agentExecutions: [],
        validationRuns: [],
        agentRuns: [],
        auditLogs: [],
        aiCache: [],
    };
}
class FileStoreAdapter {
    constructor(config) {
        this.config = config;
    }
    async ensureFile() {
        const dir = path.dirname(this.config.dataFilePath);
        await fs.mkdir(dir, { recursive: true });
        try {
            await fs.access(this.config.dataFilePath);
        }
        catch {
            const payload = {
                snapshot: createDefaultState(this.config),
                jobs: [],
            };
            await fs.writeFile(this.config.dataFilePath, JSON.stringify(payload, null, 2), 'utf8');
        }
    }
    async readRaw() {
        await this.ensureFile();
        const content = await fs.readFile(this.config.dataFilePath, 'utf8');
        return JSON.parse(content);
    }
    async writeRaw(raw) {
        await this.ensureFile();
        await fs.writeFile(this.config.dataFilePath, JSON.stringify(raw, null, 2), 'utf8');
    }
    async initialize() {
        await this.ensureFile();
    }
    async getState() {
        const raw = await this.readRaw();
        return raw.snapshot;
    }
    async saveState(state) {
        const raw = await this.readRaw();
        await this.writeRaw({ ...raw, snapshot: state });
    }
    async enqueueJob(type, payload, runAt = nowIso()) {
        const raw = await this.readRaw();
        const job = {
            id: createId('job'),
            type,
            payload,
            status: 'queued',
            attemptCount: 0,
            nextAttemptAt: runAt,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        raw.jobs.push(job);
        await this.writeRaw(raw);
        return job;
    }
    async claimJobs(limit, workerId) {
        const raw = await this.readRaw();
        const now = Date.now();
        const jobs = raw.jobs
            .filter((job) => (job.status === 'queued' || job.status === 'retryable') && new Date(job.nextAttemptAt).getTime() <= now)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .slice(0, limit)
            .map((job) => {
            job.status = 'running';
            job.lockedAt = nowIso();
            job.lockedBy = workerId;
            job.updatedAt = nowIso();
            job.attemptCount += 1;
            return job;
        });
        await this.writeRaw(raw);
        return jobs;
    }
    async completeJob(jobId) {
        const raw = await this.readRaw();
        raw.jobs = raw.jobs.filter((job) => job.id !== jobId);
        await this.writeRaw(raw);
    }
    async retryJob(jobId, lastError, nextAttemptAt) {
        const raw = await this.readRaw();
        const job = raw.jobs.find((item) => item.id === jobId);
        if (!job) {
            return;
        }
        job.status = 'retryable';
        job.lastError = lastError;
        job.nextAttemptAt = nextAttemptAt;
        job.lockedAt = null;
        job.lockedBy = null;
        job.updatedAt = nowIso();
        await this.writeRaw(raw);
    }
    async failJob(jobId, lastError) {
        const raw = await this.readRaw();
        const job = raw.jobs.find((item) => item.id === jobId);
        if (!job) {
            return;
        }
        job.status = 'failed';
        job.lastError = lastError;
        job.lockedAt = null;
        job.lockedBy = null;
        job.updatedAt = nowIso();
        await this.writeRaw(raw);
    }
}
class PostgresStoreAdapter {
    constructor(config) {
        this.config = config;
        this.pool = new Pool({
            connectionString: config.databaseUrl || undefined,
            ssl: config.databaseUrl?.includes('supabase') ? { rejectUnauthorized: false } : undefined,
        });
    }
    async initialize() {
        await this.pool.query(`
      create table if not exists app_state_snapshot (
        key text primary key,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);
        await this.pool.query(`
      create table if not exists worker_jobs (
        id text primary key,
        type text not null,
        status text not null,
        payload jsonb not null,
        attempt_count integer not null default 0,
        next_attempt_at timestamptz not null,
        locked_at timestamptz,
        locked_by text,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
        await this.pool.query(`create index if not exists worker_jobs_ready_idx on worker_jobs (status, next_attempt_at, created_at);`);
        const snapshot = await this.pool.query(`select payload from app_state_snapshot where key = $1`, [SNAPSHOT_KEY]);
        if (snapshot.rowCount === 0) {
            await this.pool.query(`insert into app_state_snapshot (key, payload) values ($1, $2::jsonb)`, [
                SNAPSHOT_KEY,
                JSON.stringify(createDefaultState(this.config)),
            ]);
        }
    }
    async getState() {
        const result = await this.pool.query(`select payload from app_state_snapshot where key = $1`, [SNAPSHOT_KEY]);
        return result.rows[0].payload;
    }
    async saveState(state) {
        await this.pool.query(`insert into app_state_snapshot (key, payload, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set payload = excluded.payload, updated_at = now()`, [SNAPSHOT_KEY, JSON.stringify(state)]);
    }
    async enqueueJob(type, payload, runAt = nowIso()) {
        const job = {
            id: createId('job'),
            type,
            status: 'queued',
            payload,
            attemptCount: 0,
            nextAttemptAt: runAt,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        await this.pool.query(`insert into worker_jobs (id, type, status, payload, attempt_count, next_attempt_at, locked_at, locked_by, last_error, created_at, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10::timestamptz, $11::timestamptz)`, [
            job.id,
            job.type,
            job.status,
            JSON.stringify(job.payload),
            job.attemptCount,
            job.nextAttemptAt,
            job.lockedAt,
            job.lockedBy,
            job.lastError,
            job.createdAt,
            job.updatedAt,
        ]);
        return job;
    }
    async claimJobs(limit, workerId) {
        const client = await this.pool.connect();
        try {
            await client.query('begin');
            const claimable = await client.query(`
          select id
          from worker_jobs
          where status in ('queued', 'retryable')
            and next_attempt_at <= now()
          order by created_at asc
          for update skip locked
          limit $1
        `, [limit]);
            if (!claimable.rowCount) {
                await client.query('commit');
                return [];
            }
            const ids = claimable.rows.map((row) => row.id);
            const updated = await client.query(`
          update worker_jobs
          set status = 'running',
              attempt_count = attempt_count + 1,
              locked_at = now(),
              locked_by = $2,
              updated_at = now()
          where id = any($1::text[])
          returning
            id,
            type,
            status,
            payload,
            attempt_count as "attemptCount",
            next_attempt_at as "nextAttemptAt",
            locked_at as "lockedAt",
            locked_by as "lockedBy",
            last_error as "lastError",
            created_at as "createdAt",
            updated_at as "updatedAt"
        `, [ids, workerId]);
            await client.query('commit');
            return updated.rows.map((row) => ({
                ...row,
                payload: row.payload,
                nextAttemptAt: row.nextAttemptAt.toISOString(),
                lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
            }));
        }
        catch (error) {
            await client.query('rollback');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async completeJob(jobId) {
        await this.pool.query(`delete from worker_jobs where id = $1`, [jobId]);
    }
    async retryJob(jobId, lastError, nextAttemptAt) {
        await this.pool.query(`update worker_jobs
       set status = 'retryable',
           last_error = $2,
           next_attempt_at = $3::timestamptz,
           locked_at = null,
           locked_by = null,
           updated_at = now()
       where id = $1`, [jobId, lastError, nextAttemptAt]);
    }
    async failJob(jobId, lastError) {
        await this.pool.query(`update worker_jobs
       set status = 'failed',
           last_error = $2,
           locked_at = null,
           locked_by = null,
           updated_at = now()
       where id = $1`, [jobId, lastError]);
    }
}
let adapterCache = null;
export function createStoreAdapter(config) {
    if (adapterCache) {
        return adapterCache;
    }
    adapterCache = config.storageDriver === 'postgres' && config.databaseUrl ? new PostgresStoreAdapter(config) : new FileStoreAdapter(config);
    return adapterCache;
}
export function pushAudit(state, action, summary, actor = 'system') {
    state.auditLogs.unshift({
        id: createId('audit'),
        action,
        actor,
        summary,
        createdAt: nowIso(),
    });
    state.auditLogs = state.auditLogs.slice(0, 80);
    return state;
}
export function pushRun(state, jobType, status, summary) {
    state.agentRuns.unshift({
        id: createId('run'),
        jobType,
        status,
        summary,
        startedAt: nowIso(),
        finishedAt: nowIso(),
    });
    state.agentRuns = state.agentRuns.slice(0, 40);
    return state;
}
export function startExecution(state, agentId, triggerSource, options) {
    const execution = {
        id: createId('exec'),
        agentId,
        status: 'running',
        triggerSource,
        parentJobId: options?.parentJobId ?? null,
        startedAt: nowIso(),
        finishedAt: null,
        summary: options?.summary ?? '',
        linkedResourceType: options?.linkedResourceType ?? null,
        linkedResourceId: options?.linkedResourceId ?? null,
        validationRunIds: [],
        steps: [],
    };
    state.agentExecutions.unshift(execution);
    state.agentExecutions = state.agentExecutions.slice(0, 160);
    return execution;
}
export function pushExecutionStep(state, executionId, step) {
    const execution = state.agentExecutions.find((item) => item.id === executionId);
    if (!execution) {
        return null;
    }
    const created = {
        id: createId('step'),
        executionId,
        createdAt: nowIso(),
        ...step,
    };
    execution.steps.push(created);
    return created;
}
export function finishExecution(state, executionId, status, summary) {
    const execution = state.agentExecutions.find((item) => item.id === executionId);
    if (!execution) {
        return null;
    }
    execution.status = status;
    execution.summary = summary;
    execution.finishedAt = nowIso();
    return execution;
}
function attachValidationToResource(state, resourceType, resourceId, validationId) {
    const attach = (target) => {
        if (!target) {
            return;
        }
        if (!target.linkedValidationIds) {
            target.linkedValidationIds = [];
        }
        if (!target.linkedValidationIds.includes(validationId)) {
            target.linkedValidationIds.push(validationId);
        }
    };
    switch (resourceType) {
        case 'candidate':
            attach(state.candidates.find((item) => item.id === resourceId));
            return;
        case 'draft':
            attach(state.listingDrafts.find((item) => item.id === resourceId));
            return;
        case 'order':
            attach(state.orders.find((item) => item.id === resourceId));
            return;
        case 'fulfillment':
            attach(state.fulfillmentJobs.find((item) => item.id === resourceId));
            return;
        case 'supplier_chat':
            attach(state.supplierChats.find((item) => item.id === resourceId));
            return;
        case 'customer_chat':
            attach(state.customerChats.find((item) => item.id === resourceId));
            return;
        default:
            return;
    }
}
export function pushValidationRun(state, run) {
    state.validationRuns.unshift(run);
    state.validationRuns = state.validationRuns.slice(0, 240);
    const execution = state.agentExecutions.find((item) => item.id === run.executionId);
    if (execution && !execution.validationRunIds.includes(run.id)) {
        execution.validationRunIds.push(run.id);
    }
    attachValidationToResource(state, run.resourceType, run.resourceId, run.id);
    return run;
}
export function appendConversationMessage(messages, message) {
    messages.push(message);
    return messages;
}
export function appendSupplierMessage(state, chatId, message, nextStatus, responseEtaHours) {
    const chat = state.supplierChats.find((item) => item.id === chatId);
    if (!chat) {
        return null;
    }
    appendConversationMessage(chat.messages, message);
    chat.lastMessage = message.message;
    chat.lastMessageAt = message.createdAt;
    if (nextStatus) {
        chat.status = nextStatus;
    }
    if (typeof responseEtaHours === 'number') {
        chat.responseEtaHours = responseEtaHours;
    }
    return chat;
}
export function appendCeoMessage(state, message) {
    state.ceoChat.messages.push(message);
    state.ceoChat.messages = state.ceoChat.messages.slice(-40);
}
