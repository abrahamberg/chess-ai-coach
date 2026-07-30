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

// UserProfileSchema requires a real-shaped email (z.string().email()) — 'dev@local'
// has no TLD and fails that check on every frontend fetch of /api/users/me, so this
// uses .test (the IANA-reserved TLD for testing) instead.
const DEV_STUB_USER: AuthUser = { email: 'dev@local.test', displayName: 'dev@local.test' };

// architecture.md §11/§12: oauth2-proxy is configured with `--skip-auth-route` for
// each of these paths and never sets X-Auth-Request-* headers on them.
//   /api/stripe/webhook — Stripe calls it directly and is authenticated instead by
//     the webhook signature (routes/stripe-webhook.ts).
//   /healthz, /readyz — the k8s kubelet probes these directly, bypassing the proxy,
//     with no headers of any kind; requiring auth here would keep every pod out of
//     the Ready state (deploy/helm/chess-ai-coach api Deployment).
const AUTH_EXEMPT_PATHS = new Set(['/api/stripe/webhook', '/healthz', '/readyz']);

/** Decorates `request.user` from oauth2-proxy's X-Auth-Request-* headers. Requests
 * without those headers get a dev-stub identity in dev-stub mode, or 401 otherwise
 * (except AUTH_EXEMPT_PATHS, which are authenticated some other way). */
export const authHeadersPlugin: FastifyPluginAsync<AuthHeadersOptions> = fp(
  (app: FastifyInstance, opts: AuthHeadersOptions) => {
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (AUTH_EXEMPT_PATHS.has(request.url)) return;

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
