import { describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';

describe('authHeadersPlugin', () => {
  test('rejects a normal route with no proxy auth headers as 401 problem+json in proxy mode', async () => {
    const app = buildApp({ authMode: 'proxy' });
    app.get('/test-route', async (request) => ({ user: request.user }));

    const response = await app.inject({ method: 'GET', url: '/test-route' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  test('dev-stub mode injects a fixed dev identity on a normal route when headers are missing', async () => {
    const app = buildApp({ authMode: 'dev-stub' });
    app.get('/test-route', async (request) => ({ user: request.user }));

    const response = await app.inject({ method: 'GET', url: '/test-route' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { email: 'dev@local.test', displayName: 'dev@local.test' } });
  });

  test.each(['/healthz', '/readyz'] as const)(
    'exempts %s (already registered by buildApp) from the proxy-header requirement',
    async (url) => {
      const app = buildApp({ authMode: 'proxy' });
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
    }
  );

  test('exempts /api/stripe/webhook from the proxy-header requirement, without setting request.user', async () => {
    const app = buildApp({ authMode: 'proxy' });
    app.post('/api/stripe/webhook', async (request) => ({ userSet: request.user !== undefined }));

    const response = await app.inject({ method: 'POST', url: '/api/stripe/webhook' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userSet: false });
  });

  test('exempts any /internal/* path from the proxy-header requirement, without requiring x-internal-token here', async () => {
    const app = buildApp({ authMode: 'proxy' });
    app.post('/internal/some-route', async (request) => ({ userSet: request.user !== undefined }));

    const response = await app.inject({ method: 'POST', url: '/internal/some-route' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userSet: false });
  });

  test('a normal (non-exempt, non-internal) path still requires proxy auth headers even if it starts similarly', async () => {
    const app = buildApp({ authMode: 'proxy' });
    app.get('/internal-but-not-really', async (request) => ({ user: request.user }));

    const response = await app.inject({ method: 'GET', url: '/internal-but-not-really' });

    // '/internal-but-not-really' does not start with '/internal/' (no trailing
    // slash prefix match), so it is NOT exempt and should still 401.
    expect(response.statusCode).toBe(401);
  });
});
