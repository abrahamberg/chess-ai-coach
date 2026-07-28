import { afterEach, describe, expect, test, vi } from 'vitest';
import { UserProfileSchema } from '@chess-coach/shared';
import { apiGet, ApiError } from './client.js';

const VALID_PROFILE = {
  id: '7d9f2a44-9a5f-4f6e-b1a1-0a4c1e2d3f4b',
  email: 'student@example.com',
  displayName: 'daniel',
  ratingBand: 'club',
  lichessUsername: null,
  chesscomUsername: null,
  selfAssessment: null,
  creditBalance: 100
};

describe('apiGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('parses a valid /users/me fixture, tolerating unknown fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...VALID_PROFILE, someFutureField: 'ignored' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const profile = await apiGet('/api/users/me', UserProfileSchema);

    expect(profile).toEqual(VALID_PROFILE);
  });

  test('throws ApiError on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/api/users/me', UserProfileSchema)).rejects.toThrow(ApiError);
  });

  test('throws on a response that fails schema validation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/api/users/me', UserProfileSchema)).rejects.toThrow();
  });

  test('ApiError carries the parsed problem+json body (e.g. {missing: "userColor"})', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ type: 'about:blank', title: 'x', status: 422, missing: 'userColor' }),
        { status: 422, headers: { 'content-type': 'application/problem+json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await apiGet('/api/games', UserProfileSchema).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toMatchObject({ missing: 'userColor' });
  });
});
