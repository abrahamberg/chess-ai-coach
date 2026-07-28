import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { buildApp } from './app.js';
import {
  ConflictError,
  InsufficientCreditsError,
  NotFoundError,
  ValidationError
} from './lib/errors.js';
import { buildTestApp } from '../test/helpers/build-app.js';

describe('probes', () => {
  test('GET /healthz always returns 200', async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
  });

  test('GET /readyz returns 200 when checkReady resolves true', async () => {
    const app = buildTestApp({ checkReady: () => Promise.resolve(true) });
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
  });

  test('GET /readyz returns 503 problem+json when checkReady resolves false', async () => {
    const app = buildTestApp({ checkReady: () => Promise.resolve(false) });
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});

describe('proxy auth headers', () => {
  test('rejects requests with no auth headers as 401 problem+json', async () => {
    const app = buildApp({ authMode: 'proxy' });
    app.get('/test-route', async (request) => ({ user: request.user }));

    const response = await app.inject({ method: 'GET', url: '/test-route' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  test('decorates request.user from X-Auth-Request-* headers and echoes it back', async () => {
    const app = buildApp({ authMode: 'proxy' });
    app.get('/test-route', async (request) => ({ user: request.user }));

    const response = await app.inject({
      method: 'GET',
      url: '/test-route',
      headers: { 'x-auth-request-email': 'ann@example.com', 'x-auth-request-user': 'Ann' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: { email: 'ann@example.com', displayName: 'Ann' } });
  });

  test('dev-stub mode injects a fixed dev identity when headers are missing, with a schema-valid email', async () => {
    const app = buildApp({ authMode: 'dev-stub' });
    app.get('/test-route', async (request) => ({ user: request.user }));

    const response = await app.inject({ method: 'GET', url: '/test-route' });

    expect(response.statusCode).toBe(200);
    const { user } = response.json();
    // UserProfileSchema (packages/shared) requires z.string().email() — the
    // frontend fetches this identity through /api/users/me on every page, so
    // a non-email-shaped stub (e.g. the old 'dev@local', no TLD) breaks every
    // screen that loads the profile.
    expect(z.string().email().safeParse(user.email).success).toBe(true);
    expect(user).toEqual({ email: user.email, displayName: user.email });
  });

  test('dev-stub mode still honors real headers when present', async () => {
    const app = buildApp({ authMode: 'dev-stub' });
    app.get('/test-route', async (request) => ({ user: request.user }));

    const response = await app.inject({
      method: 'GET',
      url: '/test-route',
      headers: { 'x-auth-request-email': 'ann@example.com', 'x-auth-request-user': 'Ann' }
    });

    expect(response.json()).toEqual({ user: { email: 'ann@example.com', displayName: 'Ann' } });
  });
});

describe('error mapping', () => {
  test('maps a thrown NotFoundError to a 404 problem+json body', async () => {
    const app = buildTestApp();
    app.get('/boom', async () => {
      throw new NotFoundError('game not found');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({ type: 'about:blank', title: 'game not found', status: 404 });
  });

  test.each([
    [ValidationError, 400],
    [InsufficientCreditsError, 402],
    [ConflictError, 409]
  ] as const)('maps %s to status %i', async (ErrorClass, status) => {
    const app = buildTestApp();
    app.get('/boom', async () => {
      throw new ErrorClass('nope');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ type: 'about:blank', title: 'nope', status });
  });

  test('maps an unexpected error to a generic 500 problem+json body', async () => {
    const app = buildTestApp();
    app.get('/boom', async () => {
      throw new Error('leaked internal detail');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.status).toBe(500);
    expect(body.title).not.toContain('leaked internal detail');
  });
});
