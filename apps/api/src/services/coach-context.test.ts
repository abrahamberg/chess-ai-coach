import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import type { ChatMessage } from '../llm/messages.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as usersRepo from '../db/repositories/users.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gameMoveQualitiesRepo from '../db/repositories/game-move-qualities.js';
import type { Database } from '../db/schema.js';
import {
  buildEpisodeContext,
  buildEpisodeMessages,
  closeEpisodeIfNeeded,
  resolvePositionContextJump
} from './coach-context.js';

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6';

/** Minimal-but-valid stand-in for a real analyzePosition() response — engine
 * visibility is a universal default now (no opt-in gate), so analyzePosition
 * is always called and tests that don't care about analysis content still
 * need a resolvable mock (renderAnalysisSection's diff runs unconditionally
 * whenever a move was played). */
function fakeAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    fen: 'irrelevant',
    depth: 16,
    multiPv: 0,
    bestMove: null,
    eval: { cp: null, mateIn: null },
    lines: [],
    features: { turn: 'white', boardState: 'none', forks: [], hangingPieces: [], availableMoves: [] },
    ...overrides
  };
}

describe('buildEpisodeMessages', () => {
  test('four cached system blocks each with their own ephemeral breakpoint, one uncached, then the episode conversation verbatim', () => {
    const episodeMessages: ChatMessage[] = [{ role: 'user', content: 'hi coach' }];
    const context = buildEpisodeMessages(
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
    const { instructions, messages } = context;
    expect(instructions).toHaveLength(5);
    expect(instructions[0]).toEqual({ role: 'system', content: 'STATIC', providerOptions: cacheControl });
    expect(instructions[1]).toEqual({ role: 'system', content: 'DYNAMIC', providerOptions: cacheControl });
    expect(instructions[2]).toEqual({ role: 'system', content: 'PGN', providerOptions: cacheControl });
    expect(instructions[3]).toEqual({ role: 'system', content: 'OTHER', providerOptions: cacheControl });
    // The current-move block is deliberately the only uncached layer.
    expect(instructions[4]).toEqual({ role: 'system', content: 'CURRENT' });
    expect(messages).toEqual(episodeMessages);
  });

  test('play mode (annotatedPgn: null, architecture §14): only 3 cached breakpoints — layer 3 is skipped entirely, not cached as an empty block', () => {
    const episodeMessages: ChatMessage[] = [{ role: 'user', content: 'hi coach' }];
    const context = buildEpisodeMessages(
      {
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        annotatedPgn: null,
        otherMovesSummary: 'OTHER',
        currentMoveBlock: 'CURRENT'
      },
      episodeMessages
    );

    const cacheControl = { anthropic: { cacheControl: { type: 'ephemeral' } } };
    const { instructions } = context;
    expect(instructions).toHaveLength(4);
    expect(instructions[0]).toEqual({ role: 'system', content: 'STATIC', providerOptions: cacheControl });
    expect(instructions[1]).toEqual({ role: 'system', content: 'DYNAMIC', providerOptions: cacheControl });
    expect(instructions[2]).toEqual({ role: 'system', content: 'OTHER', providerOptions: cacheControl });
    expect(instructions[3]).toEqual({ role: 'system', content: 'CURRENT' });
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

    test('a [diverged_line] turn (client-only hypothetical) is never mistaken for a jump — the real game position must stay put', async () => {
      const { gameId } = await seedSession();
      const jump = await resolvePositionContextJump(
        db,
        gameId,
        '[diverged_line] Exploring from move 3 (white): 3.Bc4 (position now: some-fen): what if instead?'
      );
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

    test('an episode where the coach already called record_move_note (and it succeeded) for this ply is left alone', async () => {
      const { session } = await seedSession();
      // ply 2 = moveRefToPly(1, 'black').
      const call = await sessionMessagesRepo.insert(
        db,
        session.id,
        'assistant',
        [
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'record_move_note',
            args: { moveNumber: 1, color: 'black', note: 'coach wrote this' }
          }
        ],
        2
      );
      const result = await sessionMessagesRepo.insert(
        db,
        session.id,
        'tool',
        [{ type: 'tool-result', toolCallId: 'c1', toolName: 'record_move_note', result: { recorded: true } }],
        2
      );
      const callLightModel = vi.fn();

      await closeEpisodeIfNeeded(deps(callLightModel), session.id, [call, result], 2);

      expect(callLightModel).not.toHaveBeenCalled();
      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 2);
      expect(note).toBeUndefined();
    });

    test('final review #7: a record_move_note call that ERRORED does not suppress the auto-fallback', async () => {
      const { session } = await seedSession();
      const call = await sessionMessagesRepo.insert(
        db,
        session.id,
        'assistant',
        [
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'record_move_note',
            args: { moveNumber: 1, color: 'black', note: 'coach wrote this' }
          }
        ],
        2
      );
      const result = await sessionMessagesRepo.insert(
        db,
        session.id,
        'tool',
        [{ type: 'tool-result', toolCallId: 'c1', toolName: 'record_move_note', result: { error: 'bad address' } }],
        2
      );

      await closeEpisodeIfNeeded(deps(), session.id, [call, result], 2);

      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 2);
      expect(note?.note).toBe('folded note');
    });

    test('final review #3: a light-model failure is swallowed, not thrown — best-effort, never aborts the turn', async () => {
      const { session } = await seedSession();
      const closed = await sessionMessagesRepo.insert(db, session.id, 'assistant', 'Discussing move 2.', 2);
      const callLightModel = vi.fn().mockRejectedValue(new Error('light model unavailable'));

      await expect(closeEpisodeIfNeeded(deps(callLightModel), session.id, [closed], 2)).resolves.toBeUndefined();

      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 2);
      expect(note).toBeUndefined();
    });

    test('final review #6: a revisited ply seeds the auto-fold from its own earlier closing note', async () => {
      const { session } = await seedSession();
      await sessionMoveNotesRepo.upsert(db, session.id, 2, 'first visit note');
      const closed = await sessionMessagesRepo.insert(db, session.id, 'assistant', 'second visit discussion', 2);
      const callLightModel = vi.fn().mockResolvedValue('updated note');

      await closeEpisodeIfNeeded(deps(callLightModel), session.id, [closed], 2);

      expect(callLightModel).toHaveBeenCalledOnce();
      const [prompt] = callLightModel.mock.calls[0] as [{ system: string; user: string }];
      expect(prompt.user).toContain('first visit note');
      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 2);
      expect(note?.note).toBe('updated note');
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

      const context = await buildEpisodeContext({
        db,
        callLightModel: vi.fn(),
        session: freshSession,
        currentPly: 6,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        studentColor: 'white',
        analyzePosition: vi.fn().mockResolvedValue(fakeAnalysis()),
      });

      const messages = [...context.instructions, ...context.messages];
      const serialized = JSON.stringify(messages);
      expect(serialized).not.toContain('raw talk about move 18');
      expect(serialized).toContain('discussed the knight development');
      expect(messages.at(-1)).toEqual({ role: current.role, content: current.content });
    });

    test('the "## Current position" block describes the actual current (post-move) fen and names the move played', async () => {
      const { session, gameId } = await seedSession();
      await analysesRepo.insertQueued(db, gameId).then((a) => analysesRepo.storeClassifiedMoves(db, a.id, []));
      await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
      const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);

      const context = await buildEpisodeContext({
        db,
        callLightModel: vi.fn(),
        session,
        currentPly: 2,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        studentColor: 'white',
        analyzePosition: vi.fn().mockResolvedValue(fakeAnalysis()),
      });

      // The block is a system instruction when the episode already has a
      // conversation, and the leading user message when it does not.
      const currentMoveBlock = [...context.instructions, ...context.messages].find(
        (message) => typeof message.content === 'string' && message.content.includes('## Current position')
      );
      // ply 2 is after 1.e4 e5 — the current position reflects both moves.
      expect(currentMoveBlock?.content).toContain('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
      expect(currentMoveBlock?.content).toContain('The move actually played here was e5');
      expect(currentMoveBlock?.content).not.toContain('Full engine analysis');
    });

    test('calls analyzePosition on the pre-move fen, and again on the post-move fen for the played line\'s continuation, embedding a curated summary instead of the old raw JSON dump', async () => {
      const { session, gameId } = await seedSession();
      await analysesRepo.insertQueued(db, gameId).then((a) => analysesRepo.storeClassifiedMoves(db, a.id, []));
      await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
      const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);
      // ply 2 is Black's reply to 1.e4 — the pre-move fen has Black to move,
      // so the engine's "best move" here has to be a legal black move (c5)
      // for computeFeatureDelta's applySanSequence replay to succeed.
      const analysis = {
        fen: 'irrelevant',
        depth: 16,
        multiPv: 1,
        bestMove: 'c5',
        eval: { cp: 25, mateIn: null },
        lines: [{ moveUci: 'c7c5', moveSan: 'c5', pvSan: ['c5'], cp: 25, mateIn: null }],
        features: { turn: 'black', boardState: 'none', forks: [], hangingPieces: [], availableMoves: [] }
      };
      const analyzePosition = vi.fn().mockResolvedValue(analysis);

      const context = await buildEpisodeContext({
        db,
        callLightModel: vi.fn(),
        session,
        currentPly: 2,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        studentColor: 'white',
        analyzePosition
      });

      expect(analyzePosition).toHaveBeenCalledWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
      expect(analyzePosition).toHaveBeenCalledTimes(2);
      const messages = [...context.instructions, ...context.messages];
      const serialized = JSON.stringify(messages);
      expect(serialized).not.toContain('Full engine analysis');
      expect(serialized).toContain('Played e5');
      expect(serialized).toContain("instead of the engine's best, c5");
    });

    test('still fetches the post-move analysis when the student played the engine\'s own best move — it feeds the raw JSON sections even though the curated prose collapses to one sentence', async () => {
      const { session, gameId } = await seedSession();
      await analysesRepo.insertQueued(db, gameId).then((a) => analysesRepo.storeClassifiedMoves(db, a.id, []));
      await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
      const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);
      const analysis = {
        fen: 'irrelevant',
        depth: 16,
        multiPv: 1,
        bestMove: 'e5',
        eval: { cp: 25, mateIn: null },
        lines: [{ moveUci: 'e7e5', moveSan: 'e5', pvSan: ['e5', 'Nf3'], cp: 25, mateIn: null }],
        features: { turn: 'black', boardState: 'none', forks: [], hangingPieces: [], availableMoves: [] }
      };
      const analyzePosition = vi.fn().mockResolvedValue(analysis);

      const context = await buildEpisodeContext({
        db,
        callLightModel: vi.fn(),
        session,
        currentPly: 2,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        studentColor: 'white',
        analyzePosition
      });

      expect(analyzePosition).toHaveBeenCalledTimes(2);
      const messages = [...context.instructions, ...context.messages];
      const serialized = JSON.stringify(messages);
      expect(serialized).toContain('This was the engine’s top choice.');
      expect(serialized).toContain('## Position full analyse');
      expect(serialized).toContain('## Delta against best move');
    });

    test('a revisit to a previously-closed ply seeds this episode\'s digest from that ply\'s earlier closing note, while still excluding that ply\'s earlier raw messages', async () => {
      const { session } = await seedSession();
      await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
      await sessionMessagesRepo.insert(db, session.id, 'assistant', 'first visit raw message you should never see again', 4);
      await sessionMoveNotesRepo.upsert(db, session.id, 4, 'first visit: discussed the pin');
      await sessionMessagesRepo.insert(db, session.id, 'assistant', 'unrelated detour at another ply', 5);
      await sessionMessagesRepo.insert(db, session.id, 'user', 'back again, second visit message', 4);

      const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);

      const context = await buildEpisodeContext({
        db,
        callLightModel: vi.fn(),
        session,
        currentPly: 4,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        studentColor: 'white',
        analyzePosition: vi.fn().mockResolvedValue(fakeAnalysis()),
      });

      const messages = [...context.instructions, ...context.messages];
      const serialized = JSON.stringify(messages);
      expect(serialized).toContain('[this move so far] first visit: discussed the pin');
      expect(serialized).not.toContain('first visit raw message you should never see again');
      expect(serialized).toContain('back again, second visit message');
    });

    test('a genuinely oversized still-open episode is folded via the light model, oldest messages first, with a consistently labeled digest', async () => {
      const { session } = await seedSession();
      const bigChunk = (marker: string) => `${marker} ${'x'.repeat(8000)}`;
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('OLDEST_MARKER_XYZ'), 4);
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('SECOND_MARKER'), 4);
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('THIRD_MARKER'), 4);
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('NEWEST_MARKER_ABC'), 4);

      const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);
      const callLightModel = vi.fn().mockResolvedValue('short digest');

      const context = await buildEpisodeContext({
        db,
        callLightModel,
        session,
        currentPly: 4,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        studentColor: 'white',
        analyzePosition: vi.fn().mockResolvedValue(fakeAnalysis()),
      });

      const messages = [...context.instructions, ...context.messages];
      const serialized = JSON.stringify(messages);
      expect(serialized).toContain('[this move so far] short digest');
      expect(serialized).not.toContain('OLDEST_MARKER_XYZ');
      expect(serialized).toContain('NEWEST_MARKER_ABC');

      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 4);
      expect(note?.note).toBe('short digest');
    });

    test('final review #2: compaction never splits a tool-call from its tool-result, even when the naive fold boundary lands on it', async () => {
      const { session } = await seedSession();
      const bigChunk = (marker: string) => `${marker} ${'x'.repeat(8000)}`;

      // 7 messages at the same ply, padded well past EPISODE_BUDGET_TOKENS
      // (6000). keptCount = Math.ceil(7/2) = 4, so the NAIVE fold boundary
      // (stored.length - keptCount = 3) lands exactly on index 3 below —
      // the tool-result — splitting it from its tool-call at index 2. If
      // the fix weren't applied, `kept` would start with a bare tool_result.
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('OLDEST_A'), 4); // 0
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('OLDEST_B'), 4); // 1
      await sessionMessagesRepo.insert(
        db,
        session.id,
        'assistant',
        [{ type: 'tool-call', toolCallId: 'straddle-1', toolName: 'check_position', args: { moveNumber: 2, color: 'white' } }],
        4
      ); // 2
      await sessionMessagesRepo.insert(
        db,
        session.id,
        'tool',
        [{ type: 'tool-result', toolCallId: 'straddle-1', toolName: 'check_position', result: { fen: 'irrelevant' } }],
        4
      ); // 3 <- naive boundary lands here
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('MID_C'), 4); // 4
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('MID_D'), 4); // 5
      await sessionMessagesRepo.insert(db, session.id, 'assistant', bigChunk('NEWEST_E'), 4); // 6

      const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);
      const callLightModel = vi.fn().mockResolvedValue('short digest');

      const context = await buildEpisodeContext({
        db,
        callLightModel,
        session,
        currentPly: 4,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        studentColor: 'white',
        analyzePosition: vi.fn().mockResolvedValue(fakeAnalysis()),
      });

      const messages = [...context.instructions, ...context.messages];
      assertNoOrphanedToolResults(messages);
      // The tool-call/tool-result pair should have been pulled into the
      // kept (replayed) half together, not folded away separately.
      const serialized = JSON.stringify(messages);
      expect(serialized).toContain('straddle-1');
    });

    describe('play mode (architecture §14)', () => {
      async function seedPlaySession() {
        const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
        const game = await gamesRepo.insert(db, {
          userId: user.id,
          pgn: '1. e4 e5',
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
        return { session, gameId: game.id };
      }

      test('produces exactly 3 cached breakpoints (static, dynamic, other-moves) — layer 3 (annotatedPgn) is skipped, never analyses-backed', async () => {
        const { session, gameId } = await seedPlaySession();
        await gameMoveQualitiesRepo.insert(db, {
          gameId,
          ply: 1,
          moveSan: 'e4',
          mover: 'white',
          quality: 'best',
          cpLoss: 0,
          bestLineSan: ['e4'],
          evalAfterCp: 20
        });
        await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
        const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);

        const context = await buildEpisodeContext({
          db,
          callLightModel: vi.fn(),
          session,
          currentPly: 0,
          historyAfterTurn,
          staticPart: 'STATIC',
          dynamicPart: 'DYNAMIC',
          analyzePosition: vi.fn().mockResolvedValue(fakeAnalysis()),
          studentColor: 'white'
        });

        const cachedInstructions = context.instructions.filter(
          (message) => (message as { providerOptions?: unknown }).providerOptions !== undefined
        );
        expect(cachedInstructions).toHaveLength(3);
      });

      test('the uncached current-move block folds in a "## Game so far" section built live from game_move_qualities', async () => {
        const { session, gameId } = await seedPlaySession();
        await gameMoveQualitiesRepo.insert(db, {
          gameId,
          ply: 1,
          moveSan: 'e4',
          mover: 'white',
          quality: 'best',
          cpLoss: 0,
          bestLineSan: ['e4'],
          evalAfterCp: 20
        });
        await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
        const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);

        const context = await buildEpisodeContext({
          db,
          callLightModel: vi.fn(),
          session,
          currentPly: 0,
          historyAfterTurn,
          staticPart: 'STATIC',
          dynamicPart: 'DYNAMIC',
          analyzePosition: vi.fn().mockResolvedValue(fakeAnalysis()),
          studentColor: 'white'
        });

        const serialized = JSON.stringify([...context.instructions, ...context.messages]);
        expect(serialized).toContain('## Game so far');
        expect(serialized).toContain('1.e4');
      });
    });
  });
});

/**
 * General invariant for final review #2's test: after filtering out system
 * messages, no `role: 'tool'` message may appear unless the message
 * immediately before it is an assistant message carrying a matching
 * tool-call for every toolCallId in that tool-result. A provider (Anthropic
 * or OpenAI) rejects a request that opens with — or otherwise contains — a
 * bare tool_result.
 */
function assertNoOrphanedToolResults(messages: ChatMessage[]): void {
  const nonSystem = messages.filter((message) => message.role !== 'system');
  nonSystem.forEach((message, index) => {
    const resultCallIds = toolResultCallIds(message);
    if (resultCallIds.length === 0) return;

    const preceding = nonSystem[index - 1];
    expect(preceding, `tool-result at index ${index} has no preceding message`).toBeDefined();
    expect(preceding?.role, `tool-result at index ${index}'s preceding message must be an assistant tool-call`).toBe(
      'assistant'
    );
    const callIds = preceding ? toolCallIds(preceding) : [];
    for (const id of resultCallIds) {
      expect(callIds, `tool-result callId ${id} at index ${index} has no matching preceding tool-call`).toContain(id);
    }
  });
}

function toolResultCallIds(message: ChatMessage): string[] {
  return callIdsForType(message, 'tool-result');
}

function toolCallIds(message: ChatMessage): string[] {
  return callIdsForType(message, 'tool-call');
}

function callIdsForType(message: ChatMessage, type: 'tool-call' | 'tool-result'): string[] {
  if (!Array.isArray(message.content)) return [];
  const ids: string[] = [];
  for (const part of message.content) {
    const candidate = part as { type?: unknown; toolCallId?: unknown };
    if (candidate.type === type && typeof candidate.toolCallId === 'string') ids.push(candidate.toolCallId);
  }
  return ids;
}
