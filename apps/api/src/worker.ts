import { run } from 'graphile-worker';
import { createDb } from './db/index.js';
import { createTaskList } from './jobs/index.js';
import { createKeyVault } from './llm/key-vault.js';
import type { GatewayConfig } from './llm/gateway.js';

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const db = createDb(connectionString);

  const gatewayConfig: GatewayConfig = {
    keyVault: createKeyVault(requireEnv('LLM_KEY_MASTER_KEY')),
    platformKeys: {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY
    },
    modelIds: {
      standard: {
        anthropic: requireEnv('LLM_STANDARD_MODEL_ANTHROPIC'),
        openai: requireEnv('LLM_STANDARD_MODEL_OPENAI')
      },
      light: {
        anthropic: requireEnv('LLM_LIGHT_MODEL_ANTHROPIC'),
        openai: requireEnv('LLM_LIGHT_MODEL_OPENAI')
      }
    }
  };

  const taskList = createTaskList({
    db,
    engineUrl: requireEnv('ENGINE_URL'),
    gatewayConfig
  });

  const runner = await run({ connectionString, taskList });
  await runner.promise;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
