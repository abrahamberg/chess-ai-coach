import type { Kysely } from 'kysely';
import { appendMoveToPgn, parsePgn, removeLastMoveFromPgn } from '@chess-coach/chess-analysis';
import type { MoveQuality, PositionAnalysis } from '@chess-coach/shared';
import * as gameMoveQualitiesRepo from '../db/repositories/game-move-qualities.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import type { Database } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import { classifyAndRecordMove } from './play-move-quality.js';

export interface PlayMovesDependencies {
  db: Kysely<Database>;
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
}

export interface CommittedMove {
  fen: string;
  san: string;
  ply: number;
  quality: MoveQuality;
}

/**
 * The student's move — validated and persisted before any chat turn starts
 * (architecture.md §14), symmetric with commitCoachMove below. Neither this
 * nor commitCoachMove touches sessions.currentPly; that's centralized in
 * their respective callers (the play-move route and coach-agent-turn.ts's
 * post-onFinish handling), matching how a position jump already defers the
 * ply update past its own trigger point.
 */
export async function commitPlayerMove(
  deps: PlayMovesDependencies,
  gameId: string,
  san: string
): Promise<CommittedMove | { error: string }> {
  return commitMove(deps, gameId, san);
}

/** The coach's own move, played via the play_coach_move tool. See
 * commitPlayerMove's doc comment — identical mechanics, distinct name so
 * each call site reads clearly. */
export async function commitCoachMove(
  deps: PlayMovesDependencies,
  gameId: string,
  san: string
): Promise<CommittedMove | { error: string }> {
  return commitMove(deps, gameId, san);
}

async function commitMove(
  deps: PlayMovesDependencies,
  gameId: string,
  san: string
): Promise<CommittedMove | { error: string }> {
  const game = await gamesRepo.findById(deps.db, gameId);
  if (!game) throw new NotFoundError('Game not found');

  const fenBefore = currentFen(game.pgn);
  const applied = appendMoveToPgn(game.pgn, san);
  if ('error' in applied) return applied;

  await gamesRepo.updatePgn(deps.db, gameId, applied.pgn);

  const mover = applied.ply % 2 === 1 ? 'white' : 'black';
  const classified = await classifyAndRecordMove(deps.db, deps.analyzePosition, {
    gameId,
    ply: applied.ply,
    moveSan: applied.san,
    mover,
    fenBefore,
    fenAfter: applied.fen,
    userColor: game.userColor
  });

  return { fen: applied.fen, san: applied.san, ply: applied.ply, quality: classified.quality };
}

export interface UndoResult {
  fen: string;
  /** The ply the game is left at after the undo — session.currentPly should
   * be set to this by the caller. */
  removedPly: number;
}

/**
 * Play-mode undo (architecture.md §14): pops the live game's last move —
 * legitimate because a play-mode game is in-progress, server-authored data,
 * not an immutable imported PGN. session_messages stays untouched (append-
 * only, hard project rule); the removed ply's quality row and move note are
 * deleted so nothing downstream ever references a move that no longer
 * exists.
 */
export async function undoLastMove(
  deps: PlayMovesDependencies,
  sessionId: string,
  gameId: string
): Promise<UndoResult | { error: string }> {
  const game = await gamesRepo.findById(deps.db, gameId);
  if (!game) throw new NotFoundError('Game not found');

  const removedPly = parsePgn(game.pgn).positions.at(-1)?.ply;
  if (removedPly === undefined || removedPly === 0) return { error: 'no move to undo' };

  const removed = removeLastMoveFromPgn(game.pgn);
  if ('error' in removed) return removed;

  await gamesRepo.updatePgn(deps.db, gameId, removed.pgn);
  await gameMoveQualitiesRepo.deleteByPly(deps.db, gameId, removedPly);
  await sessionMoveNotesRepo.deleteByPly(deps.db, sessionId, removedPly);

  return { fen: removed.fen, removedPly };
}

function currentFen(pgn: string): string {
  const positions = parsePgn(pgn).positions;
  const last = positions.at(-1);
  if (!last) throw new Error('parsePgn always returns at least the starting position');
  return last.fen;
}
