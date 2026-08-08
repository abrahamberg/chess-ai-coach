import { run } from 'graphile-worker';
import { buildGatewayConfigFromEnv, parsePositiveInt, requireEnv } from './bootstrap.js';
import { createDb } from './db/index.js';
import { createTaskList } from './jobs/index.js';
import { createKeyVault } from './llm/key-vault.js';

/** Daily 3 AM UTC run of prune-position-evaluations (jobs/prune-position-evaluations.ts),
 * via graphile-worker's own crontab scheduler — no external cron needed. */
const CRONTAB = '0 3 * * * prune-position-evaluations';

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const db = createDb(connectionString);
  const keyVault = createKeyVault(requireEnv('LLM_KEY_MASTER_KEY'));
  const gatewayConfig = buildGatewayConfigFromEnv(keyVault);

  const taskList = createTaskList({
    db,
    engineUrl: requireEnv('ENGINE_URL'),
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
