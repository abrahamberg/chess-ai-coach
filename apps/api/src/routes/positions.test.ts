import type { Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { PositionAnalysis } from '@chess-coach/shared';
import { buildApp } from '../app.js';
import { buildResolveEngineBackendOptions, type CoachAgentBaseDependencies } from '../bootstrap.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';

const ANALYSIS_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ENGINE_URL = 'http://engine:4001';

function analysisFixture(): PositionAnalysis {
  return {
    fen: ANALYSIS_FEN,
    depth: 16,
    multiPv: 1,
    bestMove: 'e4',
    eval: { cp: 20, mateIn: null },
    lines: [{ moveUci: 'e2e4', moveSan: 'e4', pvSan: ['e4'], cp: 20, mateIn: null }],
    features: {
      turn: 'white',
      boardState: 'none',
      availableMoves: ['e4'],
      mobility: { white: 20, black: 20 },
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
  };
}

describe('POST /api/positions/analyze', () => {
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

  function headersFor(email: string, displayName: string) {
    return { 'x-auth-request-email': email, 'x-auth-request-user': displayName };
  }

  /** The route only ever touches `db` and the resolved engine backend — the
   * rest of CoachAgentBaseDependencies is required by app.ts's shared
   * registration gate (both sessions and positions routes register
   * together) but never exercised by this route, so it's stubbed rather
   * than wired up for real. */
  function buildTestApp(
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ analysis: analysisFixture() }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
  ) {
    vi.stubGlobal('fetch', fetchMock);
    const coachAgentBaseDeps: CoachAgentBaseDependencies = {
      db,
      jobQueue: { enqueueAnalyzeGame: vi.fn(), enqueueSummarizeSession: vi.fn() },
      gatewayConfig: {
        keyVault: { encrypt: vi.fn(), decrypt: vi.fn() },
        platformKeys: {},
        modelIds: {
          standard: { anthropic: 'claude-standard', openai: 'gpt-standard' },
          light: { anthropic: 'claude-light', openai: 'gpt-light' }
        }
      },
      callLightModel: vi.fn()
    };
    const engineBackendOptions = buildResolveEngineBackendOptions(db, ENGINE_URL, { request: vi.fn() });
    return {
      app: buildApp({ authMode: 'proxy', db, coachAgentBaseDeps, engineBackendOptions }),
      fetchMock
    };
  }

  test('returns the full structured analysis for any authenticated user', async () => {
    const headers = headersFor('on@example.com', 'On');
    const { app, fetchMock } = buildTestApp();
    await app.inject({ method: 'GET', url: '/api/users/me', headers });

    const response = await app.inject({
      method: 'POST',
      url: '/api/positions/analyze',
      headers,
      payload: { fen: ANALYSIS_FEN }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(analysisFixture());
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENGINE_URL}/analyze-position`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('400s on a missing fen, without calling the engine', async () => {
    const headers = headersFor('badbody@example.com', 'Bad');
    const { app, fetchMock } = buildTestApp();
    await app.inject({ method: 'GET', url: '/api/users/me', headers });

    const response = await app.inject({
      method: 'POST',
      url: '/api/positions/analyze',
      headers,
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects requests with no auth headers as 401', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/positions/analyze',
      payload: { fen: ANALYSIS_FEN }
    });

    expect(response.statusCode).toBe(401);
  });
});
