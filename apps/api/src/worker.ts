import { run } from 'graphile-worker';
import { buildGatewayConfigFromEnv, requireEnv } from './bootstrap.js';
import { createDb } from './db/index.js';
import { createTaskList } from './jobs/index.js';
import { createKeyVault } from './llm/key-vault.js';

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const db = createDb(connectionString);
  const keyVault = createKeyVault(requireEnv('LLM_KEY_MASTER_KEY'));
  const gatewayConfig = buildGatewayConfigFromEnv(keyVault);

  const taskList = createTaskList({
    db,
    engineUrl: requireEnv('ENGINE_URL'),
    gatewayConfig
  });

  const runner = await run({ connectionString, taskList });
  await runner.promise;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
