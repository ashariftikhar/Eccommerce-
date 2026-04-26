import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import { AgentRun, AppState, AutomationSettings, CostBudget, PlatformConnection, RuntimeConfig, SystemAlert, WorkerJob, JobType } from '../types';
import { nowIso, createId } from './utils';
import { seedProhibitedRules, seedVeroRules } from './policy';

const SNAPSHOT_KEY = 'primary';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function createDefaultSettings(): AutomationSettings {
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

function createDefaultBudgets(config: RuntimeConfig): CostBudget {
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

function createDefaultConnections(config: RuntimeConfig): PlatformConnection[] {
  return [
    { name: 'eBay', status: config.ebay.env === 'sandbox' ? 'sandbox' : 'disconnected', lastCheckedAt: null },
    { name: 'CJdropshipping', status: config.cj.accessToken ? 'connected' : 'degraded', lastCheckedAt: null },
    { name: 'DeepSeek', status: config.ai.deepseekApiKey ? 'connected' : 'degraded', lastCheckedAt: null },
    { name: 'Gemini', status: config.ai.geminiApiKey ? 'connected' : 'degraded', lastCheckedAt: null },
    { name: 'Supabase / Postgres', status: config.storageDriver === 'postgres' ? 'connected' : 'degraded', lastCheckedAt: null },
  ];
}

function createDefaultAlerts(config: RuntimeConfig): SystemAlert[] {
  const alerts: SystemAlert[] = [];
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

export function createDefaultState(config: RuntimeConfig): AppState {
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
    agentRuns: [],
    auditLogs: [],
    aiCache: [],
  };
}

export interface StoreAdapter {
  initialize(): Promise<void>;
  getState(): Promise<AppState>;
  saveState(state: AppState): Promise<void>;
  enqueueJob(type: JobType, payload: Record<string, unknown>, runAt?: string): Promise<WorkerJob>;
  claimJobs(limit: number, workerId: string): Promise<WorkerJob[]>;
  completeJob(jobId: string): Promise<void>;
  retryJob(jobId: string, lastError: string, nextAttemptAt: string): Promise<void>;
  failJob(jobId: string, lastError: string): Promise<void>;
}

class FileStoreAdapter implements StoreAdapter {
  constructor(private readonly config: RuntimeConfig) {}

  private async ensureFile(): Promise<void> {
    const dir = path.dirname(this.config.dataFilePath);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(this.config.dataFilePath);
    } catch {
      const payload = {
        snapshot: createDefaultState(this.config),
        jobs: [] as WorkerJob[],
      };
      await fs.writeFile(this.config.dataFilePath, JSON.stringify(payload, null, 2), 'utf8');
    }
  }

  private async readRaw(): Promise<{ snapshot: AppState; jobs: WorkerJob[] }> {
    await this.ensureFile();
    const content = await fs.readFile(this.config.dataFilePath, 'utf8');
    return JSON.parse(content) as { snapshot: AppState; jobs: WorkerJob[] };
  }

  private async writeRaw(raw: { snapshot: AppState; jobs: WorkerJob[] }): Promise<void> {
    await this.ensureFile();
    await fs.writeFile(this.config.dataFilePath, JSON.stringify(raw, null, 2), 'utf8');
  }

  async initialize(): Promise<void> {
    await this.ensureFile();
  }

  async getState(): Promise<AppState> {
    const raw = await this.readRaw();
    return raw.snapshot;
  }

  async saveState(state: AppState): Promise<void> {
    const raw = await this.readRaw();
    await this.writeRaw({ ...raw, snapshot: state });
  }

  async enqueueJob(type: JobType, payload: Record<string, unknown>, runAt = nowIso()): Promise<WorkerJob> {
    const raw = await this.readRaw();
    const job: WorkerJob = {
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

  async claimJobs(limit: number, workerId: string): Promise<WorkerJob[]> {
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

  async completeJob(jobId: string): Promise<void> {
    const raw = await this.readRaw();
    raw.jobs = raw.jobs.filter((job) => job.id !== jobId);
    await this.writeRaw(raw);
  }

  async retryJob(jobId: string, lastError: string, nextAttemptAt: string): Promise<void> {
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

  async failJob(jobId: string, lastError: string): Promise<void> {
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

class PostgresStoreAdapter implements StoreAdapter {
  private readonly pool: Pool;

  constructor(private readonly config: RuntimeConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl || undefined,
      ssl: config.databaseUrl?.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    });
  }

  async initialize(): Promise<void> {
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

  async getState(): Promise<AppState> {
    const result = await this.pool.query(`select payload from app_state_snapshot where key = $1`, [SNAPSHOT_KEY]);
    return result.rows[0].payload as AppState;
  }

  async saveState(state: AppState): Promise<void> {
    await this.pool.query(
      `insert into app_state_snapshot (key, payload, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set payload = excluded.payload, updated_at = now()`,
      [SNAPSHOT_KEY, JSON.stringify(state)],
    );
  }

  async enqueueJob(type: JobType, payload: Record<string, unknown>, runAt = nowIso()): Promise<WorkerJob> {
    const job: WorkerJob = {
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
    await this.pool.query(
      `insert into worker_jobs (id, type, status, payload, attempt_count, next_attempt_at, locked_at, locked_by, last_error, created_at, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10::timestamptz, $11::timestamptz)`,
      [
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
      ],
    );
    return job;
  }

  async claimJobs(limit: number, workerId: string): Promise<WorkerJob[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const claimable = await client.query(
        `
          select id
          from worker_jobs
          where status in ('queued', 'retryable')
            and next_attempt_at <= now()
          order by created_at asc
          for update skip locked
          limit $1
        `,
        [limit],
      );

      if (!claimable.rowCount) {
        await client.query('commit');
        return [];
      }

      const ids = claimable.rows.map((row) => row.id);
      const updated = await client.query(
        `
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
        `,
        [ids, workerId],
      );
      await client.query('commit');
      return updated.rows.map((row) => ({
        ...row,
        payload: row.payload,
        nextAttemptAt: row.nextAttemptAt.toISOString(),
        lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeJob(jobId: string): Promise<void> {
    await this.pool.query(`delete from worker_jobs where id = $1`, [jobId]);
  }

  async retryJob(jobId: string, lastError: string, nextAttemptAt: string): Promise<void> {
    await this.pool.query(
      `update worker_jobs
       set status = 'retryable',
           last_error = $2,
           next_attempt_at = $3::timestamptz,
           locked_at = null,
           locked_by = null,
           updated_at = now()
       where id = $1`,
      [jobId, lastError, nextAttemptAt],
    );
  }

  async failJob(jobId: string, lastError: string): Promise<void> {
    await this.pool.query(
      `update worker_jobs
       set status = 'failed',
           last_error = $2,
           locked_at = null,
           locked_by = null,
           updated_at = now()
       where id = $1`,
      [jobId, lastError],
    );
  }
}

let adapterCache: StoreAdapter | null = null;

export function createStoreAdapter(config: RuntimeConfig): StoreAdapter {
  if (adapterCache) {
    return adapterCache;
  }
  adapterCache = config.storageDriver === 'postgres' && config.databaseUrl ? new PostgresStoreAdapter(config) : new FileStoreAdapter(config);
  return adapterCache;
}

export function pushAudit(state: AppState, action: string, summary: string, actor = 'system'): AppState {
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

export function pushRun(state: AppState, jobType: AgentRun['jobType'], status: AgentRun['status'], summary: string): AppState {
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
