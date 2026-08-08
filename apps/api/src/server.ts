import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';
import {
  buildCoachAgentBaseDependencies,
  buildGatewayConfigFromEnv,
  buildResolveEngineBackendOptions,
  buildStripeClientFromEnv,
  requireEnv
} from './bootstrap.js';
import { createDb } from './db/index.js';
import { createGraphileJobQueue } from './jobs/queue.js';
import { createKeyVault } from './llm/key-vault.js';
import { EngineTunnelRegistry } from './services/engine/engine-tunnel-registry.js';

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const db = createDb(connectionString);
  const keyVault = createKeyVault(requireEnv('LLM_KEY_MASTER_KEY'));
  const gatewayConfig = buildGatewayConfigFromEnv(keyVault);
  const engineUrl = requireEnv('ENGINE_URL');

  const { queue: jobQueue } = await createGraphileJobQueue(connectionString);
  const engineTunnelRegistry = new EngineTunnelRegistry();
  const engineBackendOptions = buildResolveEngineBackendOptions(db, engineUrl, engineTunnelRegistry);
  const coachAgentBaseDeps = buildCoachAgentBaseDependencies(db, jobQueue, gatewayConfig);
  const stripeClient = buildStripeClientFromEnv();

  const app = buildApp({
    db,
    jobQueue,
    keyVault,
    coachAgentBaseDeps,
    engineBackendOptions,
    engineTunnelRegistry,
    internalToken: requireEnv('ENGINE_TUNNEL_INTERNAL_TOKEN'),
    stripeClient
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}
