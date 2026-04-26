import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { DashboardPayload } from './src/types';
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
  resumeAutomation,
  runDiscoveryCycle,
} from './src/lib/pipeline';
import { createStoreAdapter } from './src/lib/store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildDashboard(): Promise<DashboardPayload> {
  const config = loadConfig();
  const store = createStoreAdapter(config);
  const state = await store.getState();
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
    recentRuns: state.agentRuns.slice(0, 10),
    auditLogs: state.auditLogs.slice(0, 12),
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
    const config = loadConfig();
    res.json({
      NODE_ENV: process.env.NODE_ENV,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? `${process.env.DEEPSEEK_API_KEY.substring(0, 5)}...${process.env.DEEPSEEK_API_KEY.substring(process.env.DEEPSEEK_API_KEY.length - 5)}` : 'NOT SET',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.substring(0, 5)}...${process.env.GEMINI_API_KEY.substring(process.env.GEMINI_API_KEY.length - 5)}` : 'NOT SET',
      CJ_API_KEY: process.env.CJ_API_KEY ? `${process.env.CJ_API_KEY.substring(0, 5)}...${process.env.CJ_API_KEY.substring(process.env.CJ_API_KEY.length - 5)}` : 'NOT SET',
      config_deepseek: config.ai.deepseekApiKey ? 'LOADED' : 'NOT LOADED',
      config_gemini: config.ai.geminiApiKey ? 'LOADED' : 'NOT LOADED',
      config_cj_token: config.cj.accessToken ? 'LOADED' : 'NOT LOADED',
    });
  });

  app.get('/api/dashboard', async (_req, res) => {
    res.json(await buildDashboard());
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
