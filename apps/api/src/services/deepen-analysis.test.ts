import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { PositionAnalysis } from '@chess-coach/shared';
import { computePositionFeatures } from '@chess-coach/chess-analysis';
import * as gamesRepo from '../db/repositories/games.js';
import * as positionEvaluationsRepo from '../db/repositories/position-evaluations.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { runDeepenAnalysisJob, type DeepenAnalysisJobDependencies } from './deepen-analysis.js';

// 15 plies (> BATCH_SIZE of 10) so the job spans more than one batch.
const PGN = `[Event "Test"]
[White "Ann"]
[Black "Bob"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 *`;

function makePositionAnalysis(fen: string): PositionAnalysis {
  return {
    fen,
    depth: 16,
    multiPv: 3,
    bestMove: null,
    eval: { cp: 0, mateIn: null },
    lines: [],
    features: computePositionFeatures(fen)
  };
}

describe('runDeepenAnalysisJob', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function setupGame(): Promise<string> {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: PGN,
      source: 'paste',
      userColor: 'white',
      whiteName: 'Ann',
      blackName: 'Bob',
      result: '*',
      timeControl: null,
      eco: null,
      playedAt: null
    });
    return game.id;
  }

  test('computes positions in concurrent batches, not strictly sequentially', async () => {
    const gameId = await setupGame();

    let inFlight = 0;
    let maxInFlight = 0;
    const analyzePosition = vi.fn(async (fen: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return makePositionAnalysis(fen);
    });
    const deps: DeepenAnalysisJobDependencies = { analyzePosition };

    await runDeepenAnalysisJob(db, deps, gameId);

    // A strictly sequential (one-at-a-time) walk would never see more than 1
    // in flight; batching via Promise.all should overlap several calls.
    expect(maxInFlight).toBeGreaterThan(1);
    expect(analyzePosition).toHaveBeenCalledTimes(16);

    const cached = await positionEvaluationsRepo.findManyByFens(
      db,
      analyzePosition.mock.calls.map(([fen]) => fen)
    );
    expect(cached.size).toBe(16);
  });

  test('skips positions already cached from another game (keyed by fen alone)', async () => {
    // A different game whose moves diverge immediately, so only the shared
    // starting position collides with what's primed below.
    const DIVERGENT_PGN = `[Event "Test"]
[White "Ann"]
[Black "Bob"]
[Result "*"]

1. d4 d5 2. c4 e6 *`;
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: DIVERGENT_PGN,
      source: 'paste',
      userColor: 'white',
      whiteName: 'Ann',
      blackName: 'Bob',
      result: '*',
      timeControl: null,
      eco: null,
      playedAt: null
    });
    const analyzePosition = vi.fn(async (fen: string) => makePositionAnalysis(fen));

    // Prime the cache with just the shared starting position before the job runs.
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    await positionEvaluationsRepo.upsertMany(db, [
      { fen: startFen, depth: 16, multiPv: 3, analysis: makePositionAnalysis(startFen) }
    ]);

    await runDeepenAnalysisJob(db, { analyzePosition }, game.id);

    expect(analyzePosition).not.toHaveBeenCalledWith(startFen);
    // 4 plies played + the (already-cached) start position = 5 total positions.
    expect(analyzePosition).toHaveBeenCalledTimes(4);
  });
});
