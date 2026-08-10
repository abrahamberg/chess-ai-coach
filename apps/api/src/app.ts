import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { Kysely } from 'kysely';
import { pingDb } from './db/index.js';
import type { Database } from './db/schema.js';
import { registerAnalysesRoutes } from './routes/analyses.js';
import { registerCreditsRoutes } from './routes/credits.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerEngineTunnelRoutes } from './routes/engine-tunnel.js';
import { registerEngineTunnelInternalRoutes } from './routes/engine-tunnel-internal.js';
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
import type { CoachAgentBaseDependencies } from './bootstrap.js';
import type { EngineTunnelRegistry } from './services/engine/engine-tunnel-registry.js';
import type { ResolveEngineBackendOptions } from './services/engine/resolve-engine-backend.js';
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
  coachAgentBaseDeps?: CoachAgentBaseDependencies;
  engineBackendOptions?: ResolveEngineBackendOptions;
  lichessClient?: LichessClient;
  /** Required to register /api/credits/checkout and /api/stripe/webhook. */
  stripeClient?: StripeClient;
  /** Required to register the browser-facing GET /api/engine-tunnel WS route. */
  engineTunnelRegistry?: EngineTunnelRegistry;
  /** Required (alongside engineTunnelRegistry) to register the worker-facing
   * POST /internal/engine-tunnel/:userId relay route. */
  internalToken?: string;
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
    if (options.coachAgentBaseDeps && options.engineBackendOptions) {
      registerSessionsRoutes(app, options.db, options.coachAgentBaseDeps, options.engineBackendOptions);
      registerPositionAnalysisRoutes(app, options.db, options.engineBackendOptions);
    }
    if (options.stripeClient) {
      registerCreditsRoutes(app, options.db, options.stripeClient);
      registerStripeWebhookRoutes(app, options.db, options.stripeClient);
    }
    if (options.engineTunnelRegistry) {
      const db = options.db;
      const registry = options.engineTunnelRegistry;
      // MUST stay inside app.after(). @fastify/websocket only turns a
      // `{ websocket: true }` route into a real WebSocket handler via an `onRoute`
      // hook it installs when the plugin finishes loading — and `app.register()`
      // above is deferred by avvio until ready(), i.e. long after this synchronous
      // function body returns. Registering the route directly here adds it to the
      // router *before* that hook exists, so the upgrade is never intercepted and
      // the handler is silently invoked as a plain HTTP route: the args arrive as
      // (request, reply) instead of (socket, request), and reading `request.user`
      // off what is actually a Reply blows up with a 500 on every connect.
      // app.after() defers to just after the plugin above has loaded.
      app.after(() => {
        registerEngineTunnelRoutes(app, db, registry);
      });
    }
  }

  // Grouped with the other engine-tunnel registration above for readability,
  // but deliberately kept outside the `if (options.db)` block: the internal
  // relay route only touches the in-memory registry, not the database, and
  // the worker process that calls it (Task 12) has no reason to require db
  // wiring on the api side to do so.
  if (options.engineTunnelRegistry && options.internalToken) {
    registerEngineTunnelInternalRoutes(app, { registry: options.engineTunnelRegistry, internalToken: options.internalToken });
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
