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
// /internal/* (checked separately below, not added to this set since it's a prefix
//   match rather than an exact path) — the worker process calls these directly, never
//   through oauth2-proxy, and is authenticated instead by a shared-secret
//   x-internal-token header (routes/engine-tunnel-internal.ts), the same pattern as
//   the Stripe webhook's signature check above.
const AUTH_EXEMPT_PATHS = new Set(['/api/stripe/webhook', '/healthz', '/readyz']);

/** Decorates `request.user` from oauth2-proxy identity headers. In reverse-proxy
 * mode (the default), oauth2-proxy v7.x passes `X-Forwarded-Email` and
 * `X-Forwarded-User` via `--pass-user-headers` (on by default). In auth_request
 * mode the older `X-Auth-Request-Email` / `X-Auth-Request-User` names are used
 * via `--set-xauthrequest`. We accept either convention. */
export const authHeadersPlugin: FastifyPluginAsync<AuthHeadersOptions> = fp(
  (app: FastifyInstance, opts: AuthHeadersOptions) => {
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (AUTH_EXEMPT_PATHS.has(request.url) || request.url.startsWith('/internal/')) return;

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
  // X-Forwarded-* — oauth2-proxy v7.x reverse-proxy mode (--pass-user-headers, default)
  const email =
    request.headers['x-auth-request-email'] ?? request.headers['x-forwarded-email'];
  const displayName =
    request.headers['x-auth-request-user'] ??
    request.headers['x-forwarded-preferred-username'] ??
    request.headers['x-forwarded-user'];

  if (typeof email !== 'string' || email.length === 0) return null;
  const resolvedName =
    typeof displayName === 'string' && displayName.length > 0 ? displayName : email;
  return { email, displayName: resolvedName };
}
