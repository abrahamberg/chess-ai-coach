import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { Kysely } from 'kysely';
import { pingDb } from './db/index.js';
import type { Database } from './db/schema.js';
import { registerAnalysesRoutes } from './routes/analyses.js';
import { registerCreditsRoutes } from './routes/credits.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerEngineTunnelRoutes } from './routes/engine-tunnel.js';
import { registerGamesRoutes } from './routes/games.js';
import { registerLichessRoutes } from './routes/lichess.js';
import { registerLlmKeysRoutes } from './routes/llm-keys.js';
import { registerPositionAnalysisRoutes } from './routes/positions.js';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerStripeWebhookRoutes } from './routes/stripe-webhook.js';
import { authHeadersPlugin, type AuthHeadersOptions } from './plugins/auth-headers.js';
import { errorMapperPlugin } from './plugins/error-mapper.js';
import { registerUsersRoutes } from './routes/users.js';
import { noopJobQueue, type JobQueue } from './jobs/queue.js';
import type { KeyVault } from './llm/key-vault.js';
import { createLichessClient, type LichessClient } from './services/lichess.js';
import type { CoachAgentDependencies } from './services/coach-agent.js';
import type { EngineTunnelRegistry } from './services/engine/engine-tunnel-registry.js';
import type { StripeClient } from './services/stripe.js';

const DEFAULT_ANALYSES_POLL_INTERVAL_MS = 1000;

export interface BuildAppOptions {
  authMode?: AuthHeadersOptions['authMode'];
  checkReady?: () => Promise<boolean>;
  db?: Kysely<Database>;
  jobQueue?: JobQueue;
  keyVault?: KeyVault;
  /** Poll interval for /api/analyses/:id/status SSE (architecture §9: 1s default). */
  analysesPollIntervalMs?: number;
  /** Required to register /api/sessions/* routes. */
  coachAgentDeps?: CoachAgentDependencies;
  lichessClient?: LichessClient;
  /** Required to register /api/credits/checkout and /api/stripe/webhook. */
  stripeClient?: StripeClient;
  /** Required to register the browser-facing GET /api/engine-tunnel WS route. */
  engineTunnelRegistry?: EngineTunnelRegistry;
}

/** Builds the Fastify app: proxy-auth header decoration, problem+json error mapping,
 * the /healthz and /readyz probes, and (when `db` is supplied) the DB-backed routes. */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const authMode = options.authMode ?? defaultAuthMode();
  const checkReady = options.checkReady ?? defaultCheckReady(options.db);

  const app = Fastify();

  app.register(errorMapperPlugin);
  app.register(authHeadersPlugin, { authMode });
  app.register(fastifyWebsocket);

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    const ready = await checkReady();
    if (!ready) {
      return reply.code(503).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Not ready',
        status: 503
      });
    }
    return { status: 'ok' };
  });

  if (options.db) {
    registerUsersRoutes(app, options.db);
    registerDashboardRoutes(app, options.db);
    registerGamesRoutes(app, options.db, options.jobQueue ?? noopJobQueue);
    registerLichessRoutes(app, options.db, options.lichessClient ?? createLichessClient());
    registerAnalysesRoutes(
      app,
      options.db,
      options.analysesPollIntervalMs ?? DEFAULT_ANALYSES_POLL_INTERVAL_MS
    );
    if (options.keyVault) {
      registerLlmKeysRoutes(app, options.db, options.keyVault);
    }
    if (options.coachAgentDeps) {
      registerSessionsRoutes(app, options.db, options.coachAgentDeps);
      registerPositionAnalysisRoutes(app, options.coachAgentDeps.analyzePosition);
    }
    if (options.stripeClient) {
      registerCreditsRoutes(app, options.db, options.stripeClient);
      registerStripeWebhookRoutes(app, options.db, options.stripeClient);
    }
    if (options.engineTunnelRegistry) {
      registerEngineTunnelRoutes(app, options.db, options.engineTunnelRegistry);
    }
  }

  return app;
}

function defaultAuthMode(): AuthHeadersOptions['authMode'] {
  return process.env.AUTH_MODE === 'dev-stub' ? 'dev-stub' : 'proxy';
}

function defaultCheckReady(db: Kysely<Database> | undefined): () => Promise<boolean> {
  if (!db) return () => Promise.resolve(true);
  return () => pingDb(db);
}
