import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { PositionAnalysis } from '@chess-coach/shared';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { buildCoachTools, type CoachToolsDependencies } from './coach-tools.js';

const TOOL_OPTIONS = { toolCallId: '1', messages: [], context: undefined } as never;

function positionAnalysisFixture(fen: string): PositionAnalysis {
  return {
    fen,
    depth: 12,
    multiPv: 1,
    bestMove: 'e4',
    eval: { cp: 20, mateIn: null },
    lines: [{ moveUci: 'e2e4', moveSan: 'e4', pvSan: ['e4'], cp: 20, mateIn: null }],
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

describe('play mode coach tools (architecture §14)', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function setupCtx() {
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
    const session = await db
      .insertInto('sessions')
      .values({ gameId: game.id, userId: user.id, status: 'active', mode: 'play' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { userId: user.id, gameId: game.id, sessionId: session.id };
  }

  function makeDeps(overrides: Partial<CoachToolsDependencies> = {}): CoachToolsDependencies {
    return {
      db,
      analyzePosition: vi.fn().mockImplementation((fen: string) => Promise.resolve(positionAnalysisFixture(fen))),
      callLightModel: vi.fn().mockResolvedValue('e4 is sound; no tactic set up.'),
      ...overrides
    };
  }

  test('get_candidate_moves returns a digested briefing, never the raw engine/tactic JSON', async () => {
    const ctx = await setupCtx();
    const deps = makeDeps();
    const tools = buildCoachTools(ctx, deps, 'play');

    const result = (await tools.get_candidate_moves?.execute?.(
      { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
      TOOL_OPTIONS
    )) as { briefing: string };

    expect(result).toEqual({ briefing: 'e4 is sound; no tactic set up.' });
    expect(deps.callLightModel).toHaveBeenCalledTimes(1);
  });

  test('play_coach_move commits the move to the live game', async () => {
    const ctx = await setupCtx();
    const tools = buildCoachTools(ctx, makeDeps(), 'play');

    const result = (await tools.play_coach_move?.execute?.({ san: 'e4' }, TOOL_OPTIONS)) as { san: string };

    expect(result.san).toBe('e4');
    const game = await gamesRepo.findById(db, ctx.gameId);
    expect(game?.pgn).toContain('e4');
  });

  test('undo_last_move on a game with no moves returns an error, not a thrown exception', async () => {
    const ctx = await setupCtx();
    const tools = buildCoachTools(ctx, makeDeps(), 'play');

    const result = await tools.undo_last_move?.execute?.({}, TOOL_OPTIONS);

    expect(result).toEqual({ error: 'no move to undo' });
  });
});
