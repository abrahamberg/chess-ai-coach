import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { EngineEval } from '@chess-coach/shared';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { runAnalyzeGameJob, type AnalysisJobDependencies } from './analysis.js';

const PGN = `[Event "Test"]
[White "Ann"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

const VALID_PLAN_JSON = JSON.stringify({
  gameSummary: 'A sharp Scholar\'s-mate-adjacent game.',
  openingNote: 'Fine through the opening.',
  themes: ['king_safety'],
  connectionToHistory: 'First session together.',
  moments: [
    {
      ply: 4,
      kind: 'user_mistake',
      category: 'king_safety',
      whatHappened: 'Missed the mating idea.',
      socraticQuestion: 'What was your opponent threatening?',
      keyLine: 'Qxf7#',
      revealDepthPlies: 2
    }
  ]
});

async function makeEval(fen: string): Promise<EngineEval> {
  return { ply: 0, fen, depth: 10, lines: [{ moveUci: 'e2e4', moveSan: 'e4', cp: 20, mateIn: null }] };
}

describe('runAnalyzeGameJob', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function setupGame(): Promise<{ gameId: string; analysisId: string }> {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: PGN,
      source: 'paste',
      userColor: 'white',
      whiteName: 'Ann',
      blackName: 'Bob',
      result: '1-0',
      timeControl: null,
      eco: null,
      playedAt: null
    });
    const analysis = await analysesRepo.insertQueued(db, game.id);
    return { gameId: game.id, analysisId: analysis.id };
  }

  function fakeEngine(): AnalysisJobDependencies['analyzeGamePositions'] {
    return vi.fn(async (fens: string[]) => Promise.all(fens.map((fen) => makeEval(fen))));
  }

  test('valid plan on the first try -> analysis ready with stored evals and plan', async () => {
    const { gameId, analysisId } = await setupGame();
    const callPlanner = vi.fn().mockResolvedValue(VALID_PLAN_JSON);
    const deps: AnalysisJobDependencies = { analyzeGamePositions: fakeEngine(), callPlanner };

    await runAnalyzeGameJob(db, deps, gameId);

    const row = await db
      .selectFrom('analyses')
      .select(['status', 'engineEvals', 'coachingPlan', 'error'])
      .where('id', '=', analysisId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('ready');
    expect(row.error).toBeNull();
    expect(row.engineEvals).toBeTruthy();
    expect((row.engineEvals as EngineEval[]).length).toBeGreaterThan(0);
    expect((row.coachingPlan as { gameSummary: string }).gameSummary).toContain('Scholar');
    expect(callPlanner).toHaveBeenCalledTimes(1);
  });

  test('invalid planner JSON once, then valid -> retries once and succeeds', async () => {
    const { gameId, analysisId } = await setupGame();
    const callPlanner = vi
      .fn()
      .mockResolvedValueOnce('not valid json at all')
      .mockResolvedValueOnce(VALID_PLAN_JSON);
    const deps: AnalysisJobDependencies = { analyzeGamePositions: fakeEngine(), callPlanner };

    await runAnalyzeGameJob(db, deps, gameId);

    const row = await db
      .selectFrom('analyses')
      .select(['status'])
      .where('id', '=', analysisId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('ready');
    expect(callPlanner).toHaveBeenCalledTimes(2);
    const [, retryCallArgs] = callPlanner.mock.calls;
    expect(retryCallArgs?.[0].user).toContain('VALIDATION ERROR');
  });

  test('invalid planner JSON twice -> failed with an error message', async () => {
    const { gameId, analysisId } = await setupGame();
    const callPlanner = vi.fn().mockResolvedValue('still not json');
    const deps: AnalysisJobDependencies = { analyzeGamePositions: fakeEngine(), callPlanner };

    await runAnalyzeGameJob(db, deps, gameId);

    const row = await db
      .selectFrom('analyses')
      .select(['status', 'error'])
      .where('id', '=', analysisId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
    expect(callPlanner).toHaveBeenCalledTimes(2);
  });

  test('engine failure -> failed with an error message, planner never called', async () => {
    const { gameId, analysisId } = await setupGame();
    const callPlanner = vi.fn();
    const deps: AnalysisJobDependencies = {
      analyzeGamePositions: vi.fn().mockRejectedValue(new Error('engine 500')),
      callPlanner
    };

    await runAnalyzeGameJob(db, deps, gameId);

    const row = await db
      .selectFrom('analyses')
      .select(['status', 'error'])
      .where('id', '=', analysisId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('failed');
    expect(row.error).toContain('engine 500');
    expect(callPlanner).not.toHaveBeenCalled();
  });
});
