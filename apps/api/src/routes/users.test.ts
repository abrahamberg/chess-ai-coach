import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';

describe('GET/PATCH /api/users/me', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  const authHeaders = { 'x-auth-request-email': 'ann@example.com', 'x-auth-request-user': 'Ann' };

  test('GET creates the user on first call, with default profile and a 100-credit signup grant', async () => {
    const app = buildApp({ authMode: 'proxy', db });

    const response = await app.inject({ method: 'GET', url: '/api/users/me', headers: authHeaders });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      email: 'ann@example.com',
      displayName: 'Ann',
      ratingBand: 'improving',
      lichessUsername: null,
      chesscomUsername: null,
      selfAssessment: null,
      showEngineAnalysis: false,
      creditBalance: 100
    });
    expect(typeof body.id).toBe('string');
  });

  test('GET a second time finds the same user and grants the signup credit only once', async () => {
    const app = buildApp({ authMode: 'proxy', db });
    const headers = { 'x-auth-request-email': 'bo@example.com', 'x-auth-request-user': 'Bo' };

    const first = await app.inject({ method: 'GET', url: '/api/users/me', headers });
    const second = await app.inject({ method: 'GET', url: '/api/users/me', headers });

    expect(first.json().id).toBe(second.json().id);
    expect(first.json().creditBalance).toBe(100);
    expect(second.json().creditBalance).toBe(100);
  });

  test('PATCH updates the rating band', async () => {
    const app = buildApp({ authMode: 'proxy', db });
    const headers = { 'x-auth-request-email': 'cleo@example.com', 'x-auth-request-user': 'Cleo' };
    await app.inject({ method: 'GET', url: '/api/users/me', headers });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers,
      payload: { ratingBand: 'advanced' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ratingBand).toBe('advanced');
  });

  test('PATCH updates showEngineAnalysis, off by default', async () => {
    const app = buildApp({ authMode: 'proxy', db });
    const headers = { 'x-auth-request-email': 'eve@example.com', 'x-auth-request-user': 'Eve' };
    await app.inject({ method: 'GET', url: '/api/users/me', headers });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers,
      payload: { showEngineAnalysis: true }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().showEngineAnalysis).toBe(true);
  });

  test('PATCH rejects a rating band outside RATING_BANDS as 400 problem+json', async () => {
    const app = buildApp({ authMode: 'proxy', db });
    const headers = { 'x-auth-request-email': 'dee@example.com', 'x-auth-request-user': 'Dee' };
    await app.inject({ method: 'GET', url: '/api/users/me', headers });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers,
      payload: { ratingBand: 'grandmaster' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  test('rejects requests with no auth headers as 401, without touching the db route logic', async () => {
    const app = buildApp({ authMode: 'proxy', db });

    const response = await app.inject({ method: 'GET', url: '/api/users/me' });

    expect(response.statusCode).toBe(401);
  });
});
