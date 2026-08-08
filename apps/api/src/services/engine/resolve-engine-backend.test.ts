import { afterEach, describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../../test/helpers/db.js';
import * as usersRepo from '../../db/repositories/users.js';
import type { Database } from '../../db/schema.js';
import { resolveEngineBackend, type ResolveEngineBackendOptions } from './resolve-engine-backend.js';
import type { EngineTunnelTransport } from './engine-tunnel-transport.js';

describe('resolveEngineBackend', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  afterEach(() => vi.unstubAllGlobals());

  function options(tunnelTransport: EngineTunnelTransport): ResolveEngineBackendOptions {
    return { db, engineUrl: 'http://engine:4001', tunnelTransport, tunnelTimeoutMs: 8000 };
  }

  test('engineMode "native" resolves to a backend that calls the engine HTTP API, not the tunnel', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ analysis: { fen: 'f', depth: 1, multiPv: 1, bestMove: null, eval: { cp: null, mateIn: null }, lines: [], features: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const tunnelTransport: EngineTunnelTransport = { request: vi.fn() };

    const backend = await resolveEngineBackend(options(tunnelTransport), user.id);
    await backend.analyzePosition('f');

    expect(fetchMock).toHaveBeenCalled();
    expect(tunnelTransport.request).not.toHaveBeenCalled();
  });

  test('engineMode "browser" resolves to a backend that calls the tunnel transport, not the engine HTTP API', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ben' });
    await usersRepo.update(db, user.id, { engineMode: 'browser' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const tunnelTransport: EngineTunnelTransport = {
      request: vi.fn().mockResolvedValue({
        fen: 'f',
        depth: 1,
        multiPv: 1,
        bestMove: null,
        eval: { cp: null, mateIn: null },
        lines: [],
        features: {
          turn: 'white',
          boardState: 'none',
          availableMoves: [],
          mobility: { white: 0, black: 0 },
          controlledSquares: [],
          piecesUnderAttack: [],
          hangingPieces: [],
          underDefendedPieces: [],
          overloadedDefenders: [],
          centerControlScore: { white: 0, black: 0 },
          openFiles: [],
          semiOpenFiles: [],
          doubledPawns: [],
          isolatedPawns: [],
          passedPawns: [],
          targetsAttacked: [],
          forks: [],
          captureOpportunities: []
        }
      })
    };

    const backend = await resolveEngineBackend(options(tunnelTransport), user.id);
    await backend.analyzePosition('f');

    expect(tunnelTransport.request).toHaveBeenCalledWith(user.id, expect.objectContaining({ kind: 'analyze-position' }), 8000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
