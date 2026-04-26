import { loadConfig } from './src/lib/config';
import { createPipelineServices, initializeServices, nextRetryIso, processJob, recordDeadLetter, runDiscoveryCycle } from './src/lib/pipeline';

async function tick(workerId: string) {
  const config = loadConfig();
  const services = createPipelineServices(config);
  await initializeServices(services);

  const state = await services.store.getState();
  const lastDiscovery = state.settings.lastDiscoveryRunAt ? new Date(state.settings.lastDiscoveryRunAt).getTime() : 0;
  const shouldAutoDiscover =
    state.settings.automationMode !== 'PAUSED' &&
    Date.now() - lastDiscovery > 24 * 60 * 60 * 1000 &&
    !state.listingDrafts.some((draft) => draft.status === 'DRAFT_READY');

  if (shouldAutoDiscover) {
    await runDiscoveryCycle(services);
  }

  const jobs = await services.store.claimJobs(10, workerId);
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
}

async function main() {
  const config = loadConfig();
  const once = process.argv.includes('--once');
  const workerId = `worker-${Math.random().toString(36).slice(2, 8)}`;

  await tick(workerId);
  if (once) {
    return;
  }

  setInterval(() => {
    tick(workerId).catch((error) => {
      console.error('Worker tick failed', error);
    });
  }, config.workerPollMs);
}

main().catch((error) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});
