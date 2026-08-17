import { afterEach, describe, expect, test, vi } from 'vitest';
import { UserProfileSchema } from '@chess-coach/shared';
import { apiDelete, apiGet, apiPatch, apiPut, ApiError } from './client.js';

const VALID_PROFILE = {
  id: '7d9f2a44-9a5f-4f6e-b1a1-0a4c1e2d3f4b',
  email: 'student@example.com',
  displayName: 'daniel',
  ratingBand: 'club',
  lichessUsername: null,
  chesscomUsername: null,
  selfAssessment: null,
  engineMode: 'native',
  coachPersona: 'general',
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

  test('forwards an AbortSignal to fetch, so React Query can cancel a stale in-flight request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(VALID_PROFILE), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await apiGet('/api/users/me', UserProfileSchema, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith('/api/users/me', expect.objectContaining({ signal: controller.signal }));
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

describe('apiPatch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('PATCHes the body and parses the JSON response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(VALID_PROFILE), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const profile = await apiPatch('/api/users/me', { ratingBand: 'club' }, UserProfileSchema);

    expect(profile).toEqual(VALID_PROFILE);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/me',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ ratingBand: 'club' }) })
    );
  });

  test('throws ApiError on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPatch('/api/users/me', {}, UserProfileSchema)).rejects.toThrow(ApiError);
  });
});

describe('apiPut / apiDelete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('apiPut sends the body and resolves on a 204 with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPut('/api/users/me/llm-keys/anthropic', { apiKey: 'sk-1' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/me/llm-keys/anthropic',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ apiKey: 'sk-1' }) })
    );
  });

  test('apiDelete resolves on a 204 with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiDelete('/api/users/me/llm-keys/anthropic')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me/llm-keys/anthropic', expect.objectContaining({ method: 'DELETE' }));
  });

  test('apiPut throws ApiError on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPut('/api/users/me/llm-keys/anthropic', { apiKey: 'x' })).rejects.toThrow(ApiError);
  });
});
