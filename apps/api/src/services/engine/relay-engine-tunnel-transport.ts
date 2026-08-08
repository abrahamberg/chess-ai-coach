import { EngineUnavailableError } from '../../lib/errors.js';
import type { EngineTunnelTransport } from './engine-tunnel-transport.js';

export interface RelayEngineTunnelTransportOptions {
  apiInternalUrl: string;
  internalToken: string;
}

/** worker.ts's EngineTunnelTransport (Task 12, not this task): the worker
 * process never holds a browser WebSocket itself, so it reaches the api
 * process's EngineTunnelRegistry over HTTP via the internal relay route
 * (routes/engine-tunnel-internal.ts) instead of talking to a registry
 * in-process. Matches EngineTunnelTransport's request() signature exactly —
 * no generic type parameter, since the interface returns Promise<unknown>. */
export class RelayEngineTunnelTransport implements EngineTunnelTransport {
  constructor(private readonly options: RelayEngineTunnelTransportOptions) {}

  async request(userId: string, payload: unknown, timeoutMs: number): Promise<unknown> {
    const response = await fetch(`${this.options.apiInternalUrl}/internal/engine-tunnel/${userId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.options.internalToken },
      body: JSON.stringify({ ...(payload as Record<string, unknown>), timeoutMs })
    });

    if (response.status === 503) {
      const body = (await response.json()) as { title?: string };
      throw new EngineUnavailableError(body.title ?? 'Engine tunnel unavailable');
    }
    if (!response.ok) throw new Error(`engine tunnel relay failed: HTTP ${response.status}`);
    const body = (await response.json()) as { result: unknown };
    return body.result;
  }
}
