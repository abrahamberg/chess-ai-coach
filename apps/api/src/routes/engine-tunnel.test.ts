import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { WebSocket } from 'ws';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { buildTestApp } from '../../test/helpers/build-app.js';
import { EngineTunnelRegistry } from '../services/engine/engine-tunnel-registry.js';
import * as userProfileService from '../services/user-profile.js';
import type { Database } from '../db/schema.js';

const DEV_STUB_USER = { email: 'dev@local.test', displayName: 'dev@local.test' };

describe('GET /api/engine-tunnel', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  test('registers the connection by user id on open, and unregisters it on close', async () => {
    const registry = new EngineTunnelRegistry();
    const registerSpy = vi.spyOn(registry, 'registerConnection');
    const unregisterSpy = vi.spyOn(registry, 'unregisterConnection');
    const app = buildTestApp({ db, engineTunnelRegistry: registry });
    await app.listen({ port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound port');
    const user = await userProfileService.getOrCreate(db, DEV_STUB_USER);

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/engine-tunnel`);
    await new Promise((resolve, reject) => {
      socket.on('open', resolve);
      socket.on('error', reject);
    });
    await vi.waitFor(() => expect(registerSpy).toHaveBeenCalledWith(user.id, expect.anything()));

    socket.close();
    await vi.waitFor(() => expect(unregisterSpy).toHaveBeenCalledWith(user.id));

    await app.close();
  });

  test('routes an inbound WebSocket message through registry.request() correlation end to end', async () => {
    const registry = new EngineTunnelRegistry();
    const registerSpy = vi.spyOn(registry, 'registerConnection');
    const app = buildTestApp({ db, engineTunnelRegistry: registry });
    await app.listen({ port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound port');
    const user = await userProfileService.getOrCreate(db, DEV_STUB_USER);

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/engine-tunnel`);
    await new Promise((resolve, reject) => {
      socket.on('open', resolve);
      socket.on('error', reject);
    });
    // Wait for the route to finish registering before issuing a request —
    // registration happens after an async getOrCreate() lookup, so it can
    // land after the client-side 'open' event fires.
    await vi.waitFor(() => expect(registerSpy).toHaveBeenCalledWith(user.id, expect.anything()));

    const sent: string[] = [];
    socket.on('message', (data: Buffer) => sent.push(data.toString()));

    const pending = registry.request(user.id, { fen: 'f' }, 5000);
    await vi.waitFor(() => expect(sent.length).toBe(1));
    const firstMessage = sent[0];
    if (firstMessage === undefined) throw new Error('expected a message to have been sent');
    const requestId = (JSON.parse(firstMessage) as { requestId: string }).requestId;

    socket.send(JSON.stringify({ requestId, result: { cp: 20 } }));

    await expect(pending).resolves.toEqual({ cp: 20 });

    socket.close();
    await app.close();
  });
});
