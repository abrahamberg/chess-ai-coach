import { run } from 'graphile-worker';
import { buildGatewayConfigFromEnv, buildResolveEngineBackendOptions, parsePositiveInt, requireEnv } from './bootstrap.js';
import { createDb } from './db/index.js';
import { createTaskList } from './jobs/index.js';
import { createKeyVault } from './llm/key-vault.js';
import { RelayEngineTunnelTransport } from './services/engine/relay-engine-tunnel-transport.js';

/** Daily 3 AM UTC run of prune-position-evaluations (jobs/prune-position-evaluations.ts),
 * via graphile-worker's own crontab scheduler — no external cron needed. */
const CRONTAB = '0 3 * * * prune-position-evaluations';

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const db = createDb(connectionString);
  const keyVault = createKeyVault(requireEnv('LLM_KEY_MASTER_KEY'));
  const gatewayConfig = buildGatewayConfigFromEnv(keyVault);
  const engineUrl = requireEnv('ENGINE_URL');

  const tunnelTransport = new RelayEngineTunnelTransport({
    apiInternalUrl: requireEnv('API_INTERNAL_URL'),
    internalToken: requireEnv('ENGINE_TUNNEL_INTERNAL_TOKEN')
  });
  const engineBackendOptions = buildResolveEngineBackendOptions(db, engineUrl, tunnelTransport);

  const taskList = createTaskList({
    db,
    engineBackendOptions,
    gatewayConfig,
    maxRows: parsePositiveInt('POSITION_EVAL_CACHE_MAX_ROWS', 200_000),
    minAgeDays: parsePositiveInt('POSITION_EVAL_CACHE_MIN_AGE_DAYS', 3)
  });

  const runner = await run({ connectionString, taskList, crontab: CRONTAB });
  await runner.promise;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
