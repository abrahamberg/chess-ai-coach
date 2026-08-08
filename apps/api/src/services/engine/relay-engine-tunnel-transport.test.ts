import { afterEach, describe, expect, test, vi } from 'vitest';
import { EngineUnavailableError } from '../../lib/errors.js';
import { RelayEngineTunnelTransport } from './relay-engine-tunnel-transport.js';

describe('RelayEngineTunnelTransport', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('posts to {apiInternalUrl}/internal/engine-tunnel/{userId} with the internal token header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { fen: 'f' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const transport = new RelayEngineTunnelTransport({ apiInternalUrl: 'http://api:3000', internalToken: 'tok' });

    const result = await transport.request('user-1', { kind: 'analyze-position', fen: 'f' }, 5000);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api:3000/internal/engine-tunnel/user-1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-token': 'tok' }),
        body: JSON.stringify({ kind: 'analyze-position', fen: 'f', timeoutMs: 5000 })
      })
    );
    expect(result).toEqual({ fen: 'f' });
  });

  test('throws EngineUnavailableError on a 503 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'no tunnel' }), { status: 503 }))
    );
    const transport = new RelayEngineTunnelTransport({ apiInternalUrl: 'http://api:3000', internalToken: 'tok' });

    await expect(transport.request('user-1', { kind: 'analyze-position', fen: 'f' }, 5000)).rejects.toBeInstanceOf(
      EngineUnavailableError
    );
  });
});
