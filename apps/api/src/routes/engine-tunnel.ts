import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { RawData } from 'ws';
import type { Database } from '../db/schema.js';
import * as userProfileService from '../services/user-profile.js';
import type { EngineTunnelRegistry, TunnelConnection } from '../services/engine/engine-tunnel-registry.js';

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

    socket.on('message', (raw: RawData) => {
      connection.onmessage?.({ data: rawDataToString(raw) });
    });

    // Pass `connection` so a late 'close' from a tab this one already replaced
    // can't evict the live connection (see EngineTunnelRegistry.unregisterConnection).
    socket.on('close', () => registry.unregisterConnection(user.id, connection));
  });
}

/** `ws`'s 'message' event delivers `Buffer | ArrayBuffer | Buffer[]` depending
 * on fragmentation/binary settings — normalize all three to a string before
 * handing off to the registry's JSON-parsing onmessage handler. */
function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}
