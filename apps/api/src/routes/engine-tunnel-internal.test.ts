import { describe, expect, test, vi } from 'vitest';
import { buildApp } from '../app.js';
import { EngineTunnelRegistry } from '../services/engine/engine-tunnel-registry.js';

const TOKEN = 'test-internal-token';

describe('POST /internal/engine-tunnel/:userId', () => {
  test('rejects a request with a missing or wrong x-internal-token as 401', async () => {
    const registry = new EngineTunnelRegistry();
    const app = buildApp({ authMode: 'proxy', engineTunnelRegistry: registry, internalToken: TOKEN });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/engine-tunnel/user-1',
      payload: { kind: 'analyze-position', fen: 'f', timeoutMs: 1000 }
    });

    expect(response.statusCode).toBe(401);
  });

  test('returns 503 problem+json when the registry has no connection for that user', async () => {
    const registry = new EngineTunnelRegistry();
    const app = buildApp({ authMode: 'proxy', engineTunnelRegistry: registry, internalToken: TOKEN });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/engine-tunnel/user-1',
      headers: { 'x-internal-token': TOKEN },
      payload: { kind: 'analyze-position', fen: 'f', timeoutMs: 1000 }
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  test('returns { result } on success by delegating to the registry', async () => {
    const registry = new EngineTunnelRegistry();
    vi.spyOn(registry, 'request').mockResolvedValue({ fen: 'f' });
    const app = buildApp({ authMode: 'proxy', engineTunnelRegistry: registry, internalToken: TOKEN });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/engine-tunnel/user-1',
      headers: { 'x-internal-token': TOKEN },
      payload: { kind: 'analyze-position', fen: 'f', timeoutMs: 1000 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: { fen: 'f' } });
    expect(registry.request).toHaveBeenCalledWith('user-1', { kind: 'analyze-position', fen: 'f' }, 1000);
  });
});
