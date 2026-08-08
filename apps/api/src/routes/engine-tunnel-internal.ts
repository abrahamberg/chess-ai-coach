import type { FastifyInstance } from 'fastify';
import { EngineUnavailableError } from '../lib/errors.js';
import type { EngineTunnelRegistry } from '../services/engine/engine-tunnel-registry.js';

export interface EngineTunnelInternalOptions {
  registry: EngineTunnelRegistry;
  internalToken: string;
}

/** Lets the worker process (which never holds a browser WebSocket itself)
 * reach the api process's tunnel registry — see plan header notes. Guarded
 * by a shared-secret header, the same pattern stripe-webhook.ts uses instead
 * of oauth2-proxy headers for non-browser traffic. */
export function registerEngineTunnelInternalRoutes(app: FastifyInstance, options: EngineTunnelInternalOptions): void {
  app.post<{ Params: { userId: string }; Body: { timeoutMs: number; [key: string]: unknown } }>(
    '/internal/engine-tunnel/:userId',
    async (request, reply) => {
      if (request.headers['x-internal-token'] !== options.internalToken) {
        return reply.code(401).type('application/problem+json').send({ type: 'about:blank', title: 'Unauthorized', status: 401 });
      }

      const { userId } = request.params;
      const { timeoutMs, ...payload } = request.body;
      try {
        const result = await options.registry.request(userId, payload, timeoutMs);
        return { result };
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return reply.code(503).type('application/problem+json').send({ type: 'about:blank', title: error.message, status: 503 });
        }
        throw error;
      }
    }
  );
}
