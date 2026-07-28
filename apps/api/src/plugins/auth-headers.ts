import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

export interface AuthUser {
  email: string;
  displayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

export interface AuthHeadersOptions {
  authMode: 'proxy' | 'dev-stub';
}

const DEV_STUB_USER: AuthUser = { email: 'dev@local', displayName: 'dev@local' };

/** Decorates `request.user` from oauth2-proxy's X-Auth-Request-* headers. Requests
 * without those headers get a dev-stub identity in dev-stub mode, or 401 otherwise. */
export const authHeadersPlugin: FastifyPluginAsync<AuthHeadersOptions> = fp(
  (app: FastifyInstance, opts: AuthHeadersOptions) => {
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const user = userFromHeaders(request);
      if (user) {
        request.user = user;
        return;
      }
      if (opts.authMode === 'dev-stub') {
        request.user = DEV_STUB_USER;
        return;
      }
      await reply.code(401).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Missing authentication headers',
        status: 401
      });
    });

    return Promise.resolve();
  }
);

function userFromHeaders(request: FastifyRequest): AuthUser | null {
  const email = request.headers['x-auth-request-email'];
  if (typeof email !== 'string' || email.length === 0) return null;
  const rawDisplayName = request.headers['x-auth-request-user'];
  const displayName =
    typeof rawDisplayName === 'string' && rawDisplayName.length > 0 ? rawDisplayName : email;
  return { email, displayName };
}
