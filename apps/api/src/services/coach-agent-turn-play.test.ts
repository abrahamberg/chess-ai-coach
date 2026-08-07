import type { Kysely } from 'kysely';
import type { PositionAnalysis } from '@chess-coach/shared';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { drain, mockResolution, multiStepModel } from '../../test/helpers/mock-model.js';
import * as gameMoveQualitiesRepo from '../db/repositories/game-move-qualities.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import * as coachAgent from './coach-agent.js';
import type { CoachAgentDependencies } from './coach-agent.js';
import { createPlaySession } from './play-session.js';

const ENGINE_EVAL: PositionAnalysis = {
  fen: 'startpos',
  depth: 10,
  multiPv: 1,
  bestMove: 'e4',
  eval: { cp: 20, mateIn: null },
  lines: [{ moveUci: 'e2e4', moveSan: 'e4', pvSan: ['e4'], cp: 20, mateIn: null }],
  features: {
    turn: 'white',
    boardState: 'none',
    availableMoves: ['e4'],
    mobility: { white: 20, black: 20 },
    controlledSquares: [],
    piecesUnderAttack: [],
    hangingPieces: [],
    underDefendedPieces: [],
    overloadedDefenders: [],
    centerControlScore: { white: 0, black: 0 },
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

/** architecture §14: the episode-per-move state machine that's genuinely new
 * in play mode — ply only advances after onFinish persists the turn, the
 * coach's own move closes (not opens) the student's-move episode, and undo
 * skips that close entirely. */
describe('coach-agent startTurn — play mode ply advance (architecture §14)', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  function deps(model: Parameters<typeof mockResolution>[0]): CoachAgentDependencies {
    return {
      db,
      jobQueue: { enqueueAnalyzeGame: vi.fn(), enqueueSummarizeSession: vi.fn() },
      gatewayConfig: {} as CoachAgentDependencies['gatewayConfig'],
      analyzePosition: vi.fn().mockResolvedValue(ENGINE_EVAL),
      callLightModel: vi.fn().mockResolvedValue('folded note'),
      resolveModel: () => Promise.resolve(mockResolution(model, { metered: false }))
    };
  }

  test('play_coach_move: currentPly only advances after the turn completes, and closes (auto-folds) the episode it was tied to', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const session = await createPlaySession(db, user.id, 'black');
    expect(session.currentPly).toBe(0);

    const model = multiStepModel([
      { toolCall: { toolCallId: 't1', toolName: 'play_coach_move', input: { san: 'e4' } }, finishReason: 'tool-calls' }
    ]);

    const turn = await coachAgent.startTurn(deps(model), session, {});
    await drain(turn);

    const updated = await sessionsRepo.findById(db, session.id);
    expect(updated?.currentPly).toBe(1);

    const game = await gamesRepo.findById(db, session.gameId);
    expect(game?.pgn).toContain('e4');

    // The ply-0 episode (session_start + this turn's own messages) had no
    // record_move_note call, so closeEpisodeIfNeeded auto-folds it.
    const note = await sessionMoveNotesRepo.findByPly(db, session.id, 0);
    expect(note?.note).toBe('folded note');
  });

  test('undo_last_move: decrements currentPly and skips closeEpisodeIfNeeded — no note is created, and the removed ply\'s raw messages stay in history (append-only)', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Bo' });
    const session = await createPlaySession(db, user.id, 'white');

    // Seed one already-played move (ply 1) as if the student had just played it.
    await gamesRepo.updatePgn(db, session.gameId, '1. e4');
    await gameMoveQualitiesRepo.insert(db, {
      gameId: session.gameId,
      ply: 1,
      moveSan: 'e4',
      mover: 'white',
      quality: 'best',
      cpLoss: 0,
      bestLineSan: ['e4'],
      evalAfterCp: 20
    });
    await sessionsRepo.updateCurrentPly(db, session.id, 1);
    await sessionMessagesRepo.insert(db, session.id, 'user', '[player_move] I played e4.', 1);
    const freshSession = { ...session, currentPly: 1 };

    const model = multiStepModel([
      { toolCall: { toolCallId: 't1', toolName: 'undo_last_move', input: {} }, finishReason: 'tool-calls' }
    ]);

    const turn = await coachAgent.startTurn(deps(model), freshSession, {});
    await drain(turn);

    const updated = await sessionsRepo.findById(db, session.id);
    expect(updated?.currentPly).toBe(0);

    expect(await gameMoveQualitiesRepo.listByGameId(db, session.gameId)).toHaveLength(0);
    expect(await sessionMoveNotesRepo.findByPly(db, session.id, 1)).toBeUndefined();

    const ply1Messages = await sessionMessagesRepo.listBySessionAndPly(db, session.id, 1);
    expect(ply1Messages.some((m) => m.content === '[player_move] I played e4.')).toBe(true);
  });
});
