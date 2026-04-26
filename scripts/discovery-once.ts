import { loadConfig } from '../src/lib/config';
import { createPipelineServices, initializeServices, runDiscoveryCycle } from '../src/lib/pipeline';

async function main() {
  const config = loadConfig();
  const services = createPipelineServices(config);
  await initializeServices(services);

  const result = await runDiscoveryCycle(services);
  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned: result.scanned,
        shortlisted: result.shortlisted,
        drafted: result.drafted,
        storageDriver: config.storageDriver,
        ebayEnv: config.ebay.env,
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
