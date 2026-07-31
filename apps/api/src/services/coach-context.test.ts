import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import type { CoreMessage } from 'ai';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as usersRepo from '../db/repositories/users.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import type { Database } from '../db/schema.js';
import {
  buildEpisodeContext,
  buildEpisodeMessages,
  closeEpisodeIfNeeded,
  resolvePositionContextJump
} from './coach-context.js';

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6';

describe('buildEpisodeMessages', () => {
  test('four cached system blocks each with their own ephemeral breakpoint, one uncached, then the episode conversation verbatim', () => {
    const episodeMessages: CoreMessage[] = [{ role: 'user', content: 'hi coach' }];
    const messages = buildEpisodeMessages(
      {
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        annotatedPgn: 'PGN',
        otherMovesSummary: 'OTHER',
        currentMoveBlock: 'CURRENT'
      },
      episodeMessages
    );

    const cacheControl = { anthropic: { cacheControl: { type: 'ephemeral' } } };
    expect(messages).toHaveLength(6);
    expect(messages[0]).toEqual({ role: 'system', content: 'STATIC', providerOptions: cacheControl });
    expect(messages[1]).toEqual({ role: 'system', content: 'DYNAMIC', providerOptions: cacheControl });
    expect(messages[2]).toEqual({ role: 'system', content: 'PGN', providerOptions: cacheControl });
    expect(messages[3]).toEqual({ role: 'system', content: 'OTHER', providerOptions: cacheControl });
    expect(messages[4]).toEqual({ role: 'system', content: 'CURRENT' });
    expect(messages[5]).toBe(episodeMessages[0]);
  });
});

describe('coach-context', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedSession(pgn = PGN) {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn,
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
    return { session, gameId: game.id };
  }

  describe('resolvePositionContextJump', () => {
    test('parses a valid [position_context] sentinel and validates it against the real game', async () => {
      const { gameId } = await seedSession();
      const jump = await resolvePositionContextJump(
        db,
        gameId,
        '[position_context] Back at move 2 (white), after Nf3: what about here instead?'
      );
      expect(jump).toEqual({ ply: 3 });
    });

    test('a ply beyond the game\'s length is never trusted, even if the text parses', async () => {
      const { gameId } = await seedSession('1. e4 e5');
      const jump = await resolvePositionContextJump(
        db,
        gameId,
        '[position_context] Back at move 40 (white), after Qxf7: huh?'
      );
      expect(jump).toBeNull();
    });

    test('ordinary text with no sentinel is not a jump', async () => {
      const { gameId } = await seedSession();
      const jump = await resolvePositionContextJump(db, gameId, 'what should I play here?');
      expect(jump).toBeNull();
    });
  });

  describe('closeEpisodeIfNeeded', () => {
    function deps(callLightModel = vi.fn().mockResolvedValue('folded note')) {
      return { db, callLightModel };
    }

    test('an episode with no record_move_note call gets an automatic note', async () => {
      const { session } = await seedSession();
      const closed = await sessionMessagesRepo.insert(db, session.id, 'assistant', 'Discussing move 2.', 2);

      await closeEpisodeIfNeeded(deps(), session.id, [closed], 2);

      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 2);
      expect(note?.note).toBe('folded note');
    });

    test('an episode where the coach already called record_move_note for this ply is left alone', async () => {
      const { session } = await seedSession();
      const closed = await sessionMessagesRepo.insert(
        db,
        session.id,
        'assistant',
        [{ type: 'tool-call', toolCallId: 'c1', toolName: 'record_move_note', args: { ply: 2, note: 'coach wrote this' } }],
        2
      );
      const callLightModel = vi.fn();

      await closeEpisodeIfNeeded(deps(callLightModel), session.id, [closed], 2);

      expect(callLightModel).not.toHaveBeenCalled();
      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 2);
      expect(note).toBeUndefined();
    });

    test('an empty closed episode is a no-op', async () => {
      const { session } = await seedSession();
      const callLightModel = vi.fn();
      await closeEpisodeIfNeeded(deps(callLightModel), session.id, [], 2);
      expect(callLightModel).not.toHaveBeenCalled();
    });
  });

  describe('buildEpisodeContext', () => {
    test('a past episode\'s raw messages are excluded from the request; only its note appears, in the other-moves-summary layer', async () => {
      const { session, gameId } = await seedSession();
      await analysesRepo.insertQueued(db, gameId).then((a) => analysesRepo.storeClassifiedMoves(db, a.id, []));
      await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
      await sessionMessagesRepo.insert(db, session.id, 'assistant', 'raw talk about move 18 you should never see again', 4);
      await sessionMoveNotesRepo.upsert(db, session.id, 4, 'discussed the knight development');
      await sessionsRepo.updateCurrentPly(db, session.id, 6);
      const current = await sessionMessagesRepo.insert(db, session.id, 'user', 'now discussing this move', 6);

      const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);
      const freshSession = { ...session, currentPly: 6 };

      const messages = await buildEpisodeContext({
        db,
        callLightModel: vi.fn(),
        session: freshSession,
        currentPly: 6,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC'
      });

      const serialized = JSON.stringify(messages);
      expect(serialized).not.toContain('raw talk about move 18');
      expect(serialized).toContain('discussed the knight development');
      expect(messages.at(-1)).toEqual({ role: current.role, content: current.content });
    });
  });
});
