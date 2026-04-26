import { loadConfig } from '../src/lib/config';
import { createPipelineServices, initializeServices, resumeAutomation, runDiscoveryCycle, sendCeoMessage } from '../src/lib/pipeline';

async function main() {
  const config = loadConfig();
  const services = createPipelineServices(config);
  await initializeServices(services);

  await resumeAutomation(services);
  await sendCeoMessage(services, 'Give me a short live status summary focused on why discovery may still be blocked or warning-only.');
  const discovery = await runDiscoveryCycle(services);
  const state = await services.store.getState();

  console.log(
    JSON.stringify(
      {
        ok: true,
        automationMode: state.settings.automationMode,
        publishingEnabled: state.settings.publishingEnabled,
        orderPushEnabled: state.settings.orderPushEnabled,
        supportAutoSend: state.settings.supportAutoSend,
        discovery,
        candidateCount: state.candidates.length,
        blockedCandidates: state.candidates.filter((item) => item.status === 'BLOCKED').length,
        readyCandidates: state.candidates.filter((item) => item.status === 'READY_TO_LIST').length,
        draftCount: state.listingDrafts.length,
        latestCeoMessageProvider: state.ceoChat.messages[state.ceoChat.messages.length - 1]?.provider || null,
        latestCeoMessageModel: state.ceoChat.messages[state.ceoChat.messages.length - 1]?.modelName || null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
