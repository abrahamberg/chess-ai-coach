import Fastify, { type FastifyInstance } from 'fastify';
import { authHeadersPlugin, type AuthHeadersOptions } from './plugins/auth-headers.js';
import { errorMapperPlugin } from './plugins/error-mapper.js';

export interface BuildAppOptions {
  authMode?: AuthHeadersOptions['authMode'];
  checkReady?: () => Promise<boolean>;
}

/** Builds the Fastify app: proxy-auth header decoration, problem+json error mapping,
 * and the /healthz and /readyz probes. Route registration happens in later tasks. */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const authMode = options.authMode ?? defaultAuthMode();
  const checkReady = options.checkReady ?? (() => Promise.resolve(true));

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

  return app;
}

function defaultAuthMode(): AuthHeadersOptions['authMode'] {
  return process.env.AUTH_MODE === 'dev-stub' ? 'dev-stub' : 'proxy';
}
