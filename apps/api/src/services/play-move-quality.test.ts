import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import type { PositionAnalysis } from '@chess-coach/shared';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as usersRepo from '../db/repositories/users.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as gameMoveQualitiesRepo from '../db/repositories/game-move-qualities.js';
import type { Database } from '../db/schema.js';
import { classifyAndRecordMove } from './play-move-quality.js';

const FEN_BEFORE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_AFTER = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function analysisFixture(fen: string, bestMove: string, cp: number): PositionAnalysis {
  return {
    fen,
    depth: 18,
    multiPv: 1,
    bestMove,
    eval: { cp, mateIn: null },
    lines: [{ moveUci: 'e2e4', moveSan: bestMove, pvSan: [bestMove], cp, mateIn: null }],
    features: {
      turn: 'white',
      boardState: 'none',
      availableMoves: [],
      mobility: { white: 20, black: 20 },
      controlledSquares: [],
      piecesUnderAttack: [],
      hangingPieces: [],
      underDefendedPieces: [],
      overloadedDefenders: [],
      centerControlScore: { white: 2, black: 2 },
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

describe('classifyAndRecordMove', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  test('the engine top choice played gets quality "best" and cpLoss 0, persisted to game_move_qualities', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: '',
      source: 'coach_play',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });

    const analyzePosition = vi
      .fn()
      .mockResolvedValueOnce(analysisFixture(FEN_BEFORE, 'e4', 20))
      .mockResolvedValueOnce(analysisFixture(FEN_AFTER, 'e4', 20));

    const classified = await classifyAndRecordMove(db, analyzePosition, {
      gameId: game.id,
      ply: 1,
      moveSan: 'e4',
      mover: 'white',
      fenBefore: FEN_BEFORE,
      fenAfter: FEN_AFTER,
      userColor: 'white'
    });

    expect(classified.quality).toBe('best');
    expect(classified.cpLoss).toBe(0);

    const rows = await gameMoveQualitiesRepo.listByGameId(db, game.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.moveSan).toBe('e4');
    expect(rows[0]?.quality).toBe('best');
  });
});
