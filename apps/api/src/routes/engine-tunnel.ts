import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import * as userProfileService from '../services/user-profile.js';
import { EngineTunnelRegistry, type TunnelConnection } from '../services/engine/engine-tunnel-registry.js';

/**
 * The browser-facing leg of the tunnel — the api process only, since this is
 * the only process that ever holds the connection (see the design plan's
 * header notes on the api/worker split). One connection per user; a second
 * tab replaces the first (EngineTunnelRegistry.registerConnection()).
 *
 * NOTE: this wires against the *actual* EngineTunnelRegistry as implemented
 * in Task 6 (registerConnection/unregisterConnection, registry-owned
 * `connection.onmessage`), which differs from the register/unregister/
 * isConnected/resolveResponse/rejectResponse API described in the original
 * plan text for this task. Per the "no changes to services/engine itself"
 * constraint, the route adapts to the registry rather than the other way
 * around. The registry sets `connection.onmessage` itself (to route
 * correlated responses back to pending requests); this route's only job is
 * to forward each raw WebSocket message into that callback and to forward
 * outbound sends onto the real socket.
 */
export function registerEngineTunnelRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  registry: EngineTunnelRegistry
): void {
  app.get('/api/engine-tunnel', { websocket: true }, async (socket, request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    const connection: TunnelConnection = {
      send: (message: string) => socket.send(message),
      onmessage: null
    };
    registry.registerConnection(user.id, connection);

    socket.on('message', (raw: Buffer) => {
      connection.onmessage?.({ data: raw.toString() });
    });

    socket.on('close', () => registry.unregisterConnection(user.id));
  });
}
