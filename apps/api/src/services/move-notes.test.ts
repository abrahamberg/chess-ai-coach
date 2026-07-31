import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as usersRepo from '../db/repositories/users.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import type { Database } from '../db/schema.js';
import { recallMove, recordMoveNote } from './move-notes.js';

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6';

describe('move-notes service', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedSession() {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: PGN,
      source: 'paste',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    const session = await sessionsRepo.insert(db, { gameId: game.id, userId: user.id });
    return { sessionId: session.id, gameId: game.id };
  }

  describe('recordMoveNote', () => {
    test('a valid ply upserts a note', async () => {
      const { sessionId, gameId } = await seedSession();
      const result = await recordMoveNote(db, { sessionId, gameId }, { ply: 2, note: 'played the Ruy Lopez idea' });
      expect(result).toEqual({ recorded: true });
      const row = await sessionMoveNotesRepo.findByPly(db, sessionId, 2);
      expect(row?.note).toBe('played the Ruy Lopez idea');
    });

    test('a ply outside the game is rejected, never trusting the model\'s own arithmetic', async () => {
      const { sessionId, gameId } = await seedSession();
      const result = await recordMoveNote(db, { sessionId, gameId }, { ply: 999, note: 'x' });
      expect(result).toEqual({ error: 'that move does not exist in this game' });
    });
  });

  describe('recallMove', () => {
    function deps(callLightModel = vi.fn()) {
      return { db, callLightModel };
    }

    test('the currently-open ply short-circuits without touching the DB or the light model', async () => {
      const { sessionId, gameId } = await seedSession();
      const callLightModel = vi.fn();
      const result = await recallMove(deps(callLightModel), { sessionId, gameId, currentPly: 4 }, 4);
      expect(result).toEqual({ text: "that's the position you're already discussing — it's already in view." });
      expect(callLightModel).not.toHaveBeenCalled();
    });

    test('a ply outside the game is rejected', async () => {
      const { sessionId, gameId } = await seedSession();
      const result = await recallMove(deps(), { sessionId, gameId, currentPly: 0 }, 999);
      expect(result).toEqual({ error: 'that move does not exist in this game' });
    });

    test('a ply with no messages and no note returns the explicit "nothing recorded" case', async () => {
      const { sessionId, gameId } = await seedSession();
      const result = await recallMove(deps(), { sessionId, gameId, currentPly: 0 }, 4);
      expect(result).toEqual({ text: 'nothing recorded for that move yet' });
    });

    test('a ply with a note but no raw messages (already folded) falls back to the note verbatim', async () => {
      const { sessionId, gameId } = await seedSession();
      await sessionMoveNotesRepo.upsert(db, sessionId, 4, 'discussed the knight retreat');
      const result = await recallMove(deps(), { sessionId, gameId, currentPly: 0 }, 4);
      expect(result).toEqual({ text: 'discussed the knight retreat' });
    });

    test('a ply with raw messages gets a fresh light-tier digest of them', async () => {
      const { sessionId, gameId } = await seedSession();
      await sessionMessagesRepo.insert(db, sessionId, 'assistant', 'What did you consider here?', 4);
      await sessionMessagesRepo.insert(db, sessionId, 'user', 'I thought about Nf6', 4);
      const callLightModel = vi.fn().mockResolvedValue('Student considered Nf6 at this move.');

      const result = await recallMove(deps(callLightModel), { sessionId, gameId, currentPly: 0 }, 4);

      expect(result).toEqual({ text: 'Student considered Nf6 at this move.' });
      expect(callLightModel).toHaveBeenCalledOnce();
    });
  });
});
