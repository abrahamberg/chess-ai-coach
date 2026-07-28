import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { pingDb } from './db/index.js';
import type { Database } from './db/schema.js';
import { registerAnalysesRoutes } from './routes/analyses.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerGamesRoutes } from './routes/games.js';
import { registerLlmKeysRoutes } from './routes/llm-keys.js';
import { registerSessionsRoutes } from './routes/sessions.js';
import { authHeadersPlugin, type AuthHeadersOptions } from './plugins/auth-headers.js';
import { errorMapperPlugin } from './plugins/error-mapper.js';
import { registerUsersRoutes } from './routes/users.js';
import { noopJobQueue, type JobQueue } from './jobs/queue.js';
import type { KeyVault } from './llm/key-vault.js';
import type { CoachAgentDependencies } from './services/coach-agent.js';

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
}

/** Builds the Fastify app: proxy-auth header decoration, problem+json error mapping,
 * the /healthz and /readyz probes, and (when `db` is supplied) the DB-backed routes. */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const authMode = options.authMode ?? defaultAuthMode();
  const checkReady = options.checkReady ?? defaultCheckReady(options.db);

  const app = Fastify();

  app.register(errorMapperPlugin);
  app.register(authHeadersPlugin, { authMode });

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
