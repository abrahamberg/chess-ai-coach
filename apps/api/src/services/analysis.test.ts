import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { CoachingPlanSchema, type EngineEval } from '@chess-coach/shared';
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

const VALID_PLAN = CoachingPlanSchema.parse({
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
    const callPlanner = vi.fn().mockResolvedValue(VALID_PLAN);
    const deps: AnalysisJobDependencies = { analyzeGamePositions: fakeEngine(), callPlanner };

    await runAnalyzeGameJob(db, deps, gameId);

    const row = await db
      .selectFrom('analyses')
      .select(['status', 'engineEvals', 'coachingPlan', 'classifiedMoves', 'error'])
      .where('id', '=', analysisId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('ready');
    expect(row.error).toBeNull();
    expect(row.engineEvals).toBeTruthy();
    expect((row.engineEvals as EngineEval[]).length).toBeGreaterThan(0);
    expect((row.coachingPlan as { gameSummary: string }).gameSummary).toContain('Scholar');
    expect(callPlanner).toHaveBeenCalledTimes(1);

    const classifiedMoves = row.classifiedMoves as Array<{ ply: number; moveSan: string; quality: string }>;
    expect(classifiedMoves.length).toBeGreaterThan(0);
    expect(classifiedMoves[0]).toMatchObject({ ply: 1, moveSan: 'e4' });
  });

  // The planner is now constrained to CoachingPlanSchema by the provider, so
  // there is no local parse-and-retry loop left to exercise: the call either
  // yields a valid plan or throws. What still has to hold is that a throw
  // leaves the analysis 'failed' with an error, never half-written or stuck
  // in 'planning' forever.
  test('a planner that cannot produce a valid plan -> failed with an error message', async () => {
    const { gameId, analysisId } = await setupGame();
    const callPlanner = vi.fn().mockRejectedValue(new Error('could not generate a valid object'));
    const deps: AnalysisJobDependencies = { analyzeGamePositions: fakeEngine(), callPlanner };

    await runAnalyzeGameJob(db, deps, gameId);

    const row = await db
      .selectFrom('analyses')
      .select(['status', 'error'])
      .where('id', '=', analysisId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
    expect(callPlanner).toHaveBeenCalledTimes(1);
  });

  // The percentage on the import screen is derived from how many evals are
  // stored, so partial results have to land while the engine step is still
  // running rather than all at once when it finishes.
  test('analyzes in chunks, persisting evals as it goes so progress is observable mid-run', async () => {
    const { gameId, analysisId } = await setupGame();
    const callPlanner = vi.fn().mockResolvedValue(VALID_PLAN);

    const storedBeforeEachCall: number[] = [];
    const chunkSizes: number[] = [];
    const analyzeGamePositions = vi.fn(async (fens: string[]) => {
      const row = await db
        .selectFrom('analyses')
        .select('engineEvals')
        .where('id', '=', analysisId)
        .executeTakeFirstOrThrow();
      storedBeforeEachCall.push(((row.engineEvals as EngineEval[] | null) ?? []).length);
      chunkSizes.push(fens.length);
      return Promise.all(fens.map((fen) => makeEval(fen)));
    });

    await runAnalyzeGameJob(db, { analyzeGamePositions, callPlanner }, gameId);

    // This PGN is 8 positions against a chunk size of 6.
    expect(chunkSizes.length).toBeGreaterThan(1);
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(6);
    // The second call saw the first chunk's evals already committed.
    expect(storedBeforeEachCall[0]).toBe(0);
    expect(storedBeforeEachCall[1]).toBe(chunkSizes[0]);

    const row = await db
      .selectFrom('analyses')
      .select(['status', 'engineEvals'])
      .where('id', '=', analysisId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('ready');
    // Every position still gets analyzed exactly once.
    expect((row.engineEvals as EngineEval[]).length).toBe(chunkSizes.reduce((a, b) => a + b, 0));
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
