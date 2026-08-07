import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import type { PositionAnalysis } from '@chess-coach/shared';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { commitPlayerMoveAndAdvance } from './play-move-commit.js';

function analysisFixture(fen: string): PositionAnalysis {
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

describe('commitPlayerMoveAndAdvance (architecture §14)', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  const analyzePosition = vi.fn().mockImplementation((fen: string) => Promise.resolve(analysisFixture(fen)));
  const callLightModel = vi.fn().mockResolvedValue('folded note');

  async function seed() {
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
    const session = await sessionsRepo.insert(db, { gameId: game.id, userId: user.id, mode: 'play' });
    return session;
  }

  test('commits the move, advances sessions.currentPly, and closes the prior episode', async () => {
    const session = await seed();
    await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);

    const result = await commitPlayerMoveAndAdvance({ db, analyzePosition, callLightModel }, session, 'e4');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.ply).toBe(1);

    const updated = await sessionsRepo.findById(db, session.id);
    expect(updated?.currentPly).toBe(1);

    const note = await sessionMoveNotesRepo.findByPly(db, session.id, 0);
    expect(note?.note).toBe('folded note');
  });

  test('an illegal move returns { error } and never touches sessions.currentPly', async () => {
    const session = await seed();

    const result = await commitPlayerMoveAndAdvance({ db, analyzePosition, callLightModel }, session, 'Z9');

    expect(result).toEqual({ error: expect.stringContaining('Illegal move') });
    const unchanged = await sessionsRepo.findById(db, session.id);
    expect(unchanged?.currentPly).toBe(0);
  });
});
