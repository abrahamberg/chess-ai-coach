import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildApp } from '../app.js';
import { buildResolveEngineBackendOptions, type CoachAgentBaseDependencies } from '../bootstrap.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gameMoveQualitiesRepo from '../db/repositories/game-move-qualities.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import { createKeyVault } from '../llm/key-vault.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';

const VALID_PGN = `[Event "Test"]
[White "Ann"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

const ILLEGAL_PGN = `[Event "Test"]

1. e4 e5 2. Zz9 garbage`;

const UNMATCHED_HEADERS_PGN = `[Event "Test"]
[White "Somebody"]
[Black "Someone"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

describe('POST/GET /api/games', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;
  let jobQueue: JobQueue;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  function headersFor(email: string, displayName: string) {
    return { 'x-auth-request-email': email, 'x-auth-request-user': displayName };
  }

  function buildTestApp() {
    jobQueue = {
      enqueueAnalyzeGame: vi.fn().mockResolvedValue(undefined),
      enqueueSummarizeSession: vi.fn().mockResolvedValue(undefined)
    };
    // Required to register /api/sessions/* (POST /api/sessions/play, used by
    // the coach_play listing test below) — the LLM-facing fields are never
    // exercised by these games-route tests, so they're unused stubs.
    const coachAgentBaseDeps: CoachAgentBaseDependencies = {
      db,
      jobQueue,
      gatewayConfig: {
        keyVault: createKeyVault(Buffer.alloc(32, 7).toString('base64')),
        platformKeys: {},
        modelIds: { standard: { anthropic: '', openai: '' }, light: { anthropic: '', openai: '' } }
      },
      callLightModel: vi.fn()
    };
    const engineBackendOptions = buildResolveEngineBackendOptions(db, 'http://engine:4001', { request: vi.fn() });
    return buildApp({ authMode: 'proxy', db, jobQueue, coachAgentBaseDeps, engineBackendOptions });
  }

  test('imports a valid PGN, creating a queued analysis and enqueuing the job', async () => {
    const app = buildTestApp();
    const headers = headersFor('ann-import@example.com', 'Ann');

    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers,
      payload: { pgn: VALID_PGN, source: 'paste', userColor: 'white' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.gameId).toBe('string');
    expect(typeof body.analysisId).toBe('string');

    const game = await db
      .selectFrom('games')
      .selectAll()
      .where('id', '=', body.gameId)
      .executeTakeFirstOrThrow();
    expect(game.pgn).toBe(VALID_PGN);
    expect(game.userColor).toBe('white');

    const analysis = await db
      .selectFrom('analyses')
      .selectAll()
      .where('id', '=', body.analysisId)
      .executeTakeFirstOrThrow();
    expect(analysis.status).toBe('queued');
    expect(analysis.gameId).toBe(body.gameId);

    expect(jobQueue.enqueueAnalyzeGame).toHaveBeenCalledWith(body.gameId);
  });

  test('detects userColor from PGN headers when omitted from the request', async () => {
    const app = buildTestApp();
    const headers = headersFor('ann-detect@example.com', 'Ann');

    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers,
      payload: { pgn: VALID_PGN, source: 'paste' }
    });

    expect(response.statusCode).toBe(200);
    const game = await db
      .selectFrom('games')
      .selectAll()
      .where('id', '=', response.json().gameId)
      .executeTakeFirstOrThrow();
    expect(game.userColor).toBe('white');
  });

  test('rejects an illegal PGN as 400 problem+json', async () => {
    const app = buildTestApp();
    const headers = headersFor('illegal@example.com', 'Illegal');

    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers,
      payload: { pgn: ILLEGAL_PGN, source: 'paste', userColor: 'white' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  test('rejects an ambiguous/undetectable userColor as 422 with {missing: "userColor"}', async () => {
    const app = buildTestApp();
    const headers = headersFor('ambiguous@example.com', 'Ambiguous');

    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers,
      payload: { pgn: UNMATCHED_HEADERS_PGN, source: 'paste' }
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().missing).toBe('userColor');
  });

  test('rate limits at 10 imports/day, returning 429 on the 11th', async () => {
    const app = buildTestApp();
    const headers = headersFor('prolific@example.com', 'Prolific');
    const importOnce = () =>
      app.inject({
        method: 'POST',
        url: '/api/games',
        headers,
        payload: { pgn: VALID_PGN, source: 'paste', userColor: 'white' }
      });

    for (let i = 0; i < 10; i++) {
      const response = await importOnce();
      expect(response.statusCode).toBe(200);
    }

    const eleventh = await importOnce();
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.headers['content-type']).toContain('application/problem+json');
  });

  test('GET /api/games lists only the current user\'s games; GET /api/games/:id returns one with analysis status', async () => {
    const app = buildTestApp();
    const headers = headersFor('lister@example.com', 'Lister');
    const imported = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers,
      payload: { pgn: VALID_PGN, source: 'paste', userColor: 'white' }
    });
    const { gameId } = imported.json();

    const list = await app.inject({ method: 'GET', url: '/api/games', headers });
    expect(list.statusCode).toBe(200);
    const games = list.json();
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: gameId, analysisStatus: 'queued' });

    const detail = await app.inject({ method: 'GET', url: `/api/games/${gameId}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: gameId, analysisStatus: 'queued' });
  });

  test('GET /api/games/:id includes the persisted per-move classification once analysis stored it', async () => {
    const app = buildTestApp();
    const headers = headersFor('classified@example.com', 'Classy');
    const imported = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers,
      payload: { pgn: VALID_PGN, source: 'paste', userColor: 'white' }
    });
    const { gameId } = imported.json();
    const analysis = await analysesRepo.findByGameId(db, gameId);
    if (!analysis) throw new Error('expected an analysis row to exist for the imported game');
    await analysesRepo.storeClassifiedMoves(db, analysis.id, [
      {
        ply: 1,
        moveSan: 'e4',
        mover: 'white',
        isUserMove: true,
        cpLoss: 0,
        quality: 'good',
        bestLineSan: ['e4'],
        evalAfterCp: 20,
        hangsPiece: false
      }
    ]);

    const detail = await app.inject({ method: 'GET', url: `/api/games/${gameId}`, headers });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().classifiedMoves).toEqual([
      expect.objectContaining({ ply: 1, moveSan: 'e4', quality: 'good' })
    ]);
  });

  test('GET /api/games/:id returns liveMoveQualities (never classifiedMoves) for a coach_play game, with no analyses lookup', async () => {
    const app = buildTestApp();
    const headers = headersFor('playgame@example.com', 'Playgame');

    // coach_play games are only ever created via createPlaySession
    // (POST /api/sessions/play), never via POST /api/games — seed one
    // directly at the repo layer, matching how play-session.test.ts does.
    const owner = await usersRepo.insert(db, { email: 'playgame@example.com', displayName: 'Playgame' });
    const game = await gamesRepo.insert(db, {
      userId: owner.id,
      pgn: '1. e4',
      source: 'coach_play',
      userColor: 'white',
      whiteName: 'You',
      blackName: 'Coach',
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    await gameMoveQualitiesRepo.insert(db, {
      gameId: game.id,
      ply: 1,
      moveSan: 'e4',
      mover: 'white',
      quality: 'best',
      cpLoss: 0,
      bestLineSan: ['e4'],
      evalAfterCp: 20
    });

    const detail = await app.inject({ method: 'GET', url: `/api/games/${game.id}`, headers });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().classifiedMoves).toBeNull();
    expect(detail.json().liveMoveQualities).toEqual([expect.objectContaining({ ply: 1, moveSan: 'e4', quality: 'best' })]);
  });

  test('GET /api/games lists a coach_play game with source and its resumable sessionId, not "analyzing"', async () => {
    const app = buildTestApp();
    const headers = headersFor('playlister@example.com', 'Playlister');

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/play',
      headers,
      payload: { studentColor: 'white' }
    });
    expect(response.statusCode).toBe(200);
    const { id: sessionId, gameId } = response.json();

    const list = await app.inject({ method: 'GET', url: '/api/games', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([
      expect.objectContaining({ id: gameId, source: 'coach_play', analysisStatus: null, sessionId })
    ]);
  });

  test('GET /api/games/:id 404s for another user\'s game', async () => {
    const app = buildTestApp();
    const owner = headersFor('owner@example.com', 'Owner');
    const intruder = headersFor('intruder@example.com', 'Intruder');
    const imported = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: owner,
      payload: { pgn: VALID_PGN, source: 'paste', userColor: 'white' }
    });
    const { gameId } = imported.json();

    const response = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: intruder
    });

    expect(response.statusCode).toBe(404);
  });
});
