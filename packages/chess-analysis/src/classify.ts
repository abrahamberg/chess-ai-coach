import { Chess } from 'chess.js';
import type { EngineEval, EngineLine, MoveQuality } from '@chess-coach/shared';
import type { ParsedGame } from './pgn.js';

const MATE_CP = 1000;
const INTERESTING_THRESHOLD_CP = 20;
const DUBIOUS_THRESHOLD_CP = 50;
const MISTAKE_THRESHOLD_CP = 100;
const BLUNDER_THRESHOLD_CP = 300;
const WINNING_POSITION_CP = 300;

/** Static piece values for the sacrifice heuristic — not engine-precise, just
 * enough to tell "gave up more than it's worth" from "traded evenly". */
const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export interface ClassifiedMove {
  ply: number;
  moveSan: string;
  mover: 'white' | 'black';
  isUserMove: boolean;
  cpLoss: number;
  quality: MoveQuality;
  bestLineSan: string[];
  evalAfterCp: number;
}

/**
 * Classifies every move of a parsed game by centipawn loss relative to the
 * engine's best move, using `evals[i]` as the engine evaluation of the
 * position at `game.positions[i]` (evals and positions are index-aligned).
 *
 * Every move (both colors) is classified; only `isUserMove` distinguishes
 * moves made by `userColor`.
 */
export function classifyMoves(
  game: ParsedGame,
  evals: EngineEval[],
  userColor: 'white' | 'black'
): ClassifiedMove[] {
  return game.positions.slice(1).map((position, index) => {
    const evalBefore = evals[index];
    const evalAfter = evals[index + 1];
    const fenBefore = game.positions[index]?.fen;
    return classifyMove(position, evalBefore, evalAfter, userColor, fenBefore);
  });
}

function classifyMove(
  position: ParsedGame['positions'][number],
  evalBefore: EngineEval | undefined,
  evalAfter: EngineEval | undefined,
  userColor: 'white' | 'black',
  fenBefore: string | undefined
): ClassifiedMove {
  const mover = position.mover ?? 'white';
  const bestCp = toMoverPerspective(whitePerspectiveCp(bestLine(evalBefore)), mover);
  // A checkmating move ends the game — there are no legal moves left to
  // search, so the engine returns no lines for the resulting position, and
  // whitePerspectiveCp's `undefined` fallback (0) would otherwise make
  // delivering mate look like the biggest possible blunder. Delivering mate
  // is definitionally the best move, so skip the cp-loss math entirely.
  const deliveredMate = position.moveSan?.endsWith('#') ?? false;
  const playedCp = deliveredMate ? bestCp : toMoverPerspective(whitePerspectiveCp(bestLine(evalAfter)), mover);
  const cpLoss = clamp(bestCp - playedCp, 0, MATE_CP);
  const sacrifice =
    fenBefore !== undefined && position.moveSan !== null && isSacrifice(fenBefore, position.moveSan);

  return {
    ply: position.ply,
    moveSan: position.moveSan ?? '',
    mover,
    isUserMove: mover === userColor,
    cpLoss,
    quality: qualityFor(cpLoss, sacrifice, bestCp),
    bestLineSan: bestLineSan(evalBefore),
    evalAfterCp: whitePerspectiveCp(bestLine(evalAfter))
  };
}

/**
 * Best-effort brilliancy signal: true when a NON-capture move by a piece
 * other than a pawn/king lands on a square an enemy piece of equal-or-lesser
 * value could capture — an "offer" the opponent could refuse, not an
 * ordinary trade. Captures are excluded on purpose (they're evaluated by
 * cpLoss already, not by this heuristic). This is not static-exchange
 * evaluation — it only looks one ply deep — so it will miss real sacrifices
 * that involve a longer tactical sequence and can occasionally flag a move
 * that's "offered" but never actually en prise in a meaningful sense.
 */
export function isSacrifice(fenBefore: string, moveSan: string): boolean {
  const chess = new Chess(fenBefore);
  let move;
  try {
    move = chess.move(moveSan);
  } catch {
    return false;
  }
  if (!move || move.captured) return false;
  if (move.piece === 'p' || move.piece === 'k') return false;

  const opponentColor = move.color === 'w' ? 'b' : 'w';
  if (!chess.isAttacked(move.to, opponentColor)) return false;

  const movedValue = PIECE_VALUES[move.piece] ?? 0;
  return chess.attackers(move.to, opponentColor).some((square) => {
    const piece = chess.get(square);
    return piece !== undefined && (PIECE_VALUES[piece.type] ?? 0) <= movedValue;
  });
}

/** Converts a white-perspective centipawn score to the given mover's perspective. */
export function toMoverPerspective(whiteCp: number, mover: 'white' | 'black'): number {
  return mover === 'white' ? whiteCp : -whiteCp;
}

/** Maps a mate-in-N score to a white-perspective centipawn value: +N (white mates) -> +1000, -N (black mates) -> -1000. */
function mateToCp(mateIn: number): number {
  return mateIn > 0 ? MATE_CP : -MATE_CP;
}

/**
 * Bucket a non-negative centipawn loss (plus the sacrifice signal and the
 * mover-perspective eval of the position BEFORE the move) into a move
 * quality per the fixed thresholds.
 *
 * `bestCpBeforeMoverPerspective` powers the `miss` tier: a move that would
 * otherwise be a `mistake`/`blunder` (cpLoss >= MISTAKE_THRESHOLD_CP)
 * reclassifies to `miss` when the mover was already clearly winning
 * (>= WINNING_POSITION_CP) before playing it — "you were winning big and
 * gave a lot of it back". This is an approximation, not true chess.com-style
 * detection (which compares the engine's top-2 lines) — see
 * docs/superpowers/specs/2026-07-29-move-quality-badges-design.md.
 */
export function qualityFor(cpLoss: number, isSacrifice = false, bestCpBeforeMoverPerspective = 0): MoveQuality {
  const wasWinningBig = bestCpBeforeMoverPerspective >= WINNING_POSITION_CP;
  if (cpLoss >= BLUNDER_THRESHOLD_CP) return wasWinningBig ? 'miss' : 'blunder';
  if (cpLoss >= MISTAKE_THRESHOLD_CP) return wasWinningBig ? 'miss' : 'mistake';
  if (cpLoss >= DUBIOUS_THRESHOLD_CP) return 'dubious';
  if (cpLoss >= INTERESTING_THRESHOLD_CP) return 'interesting';
  if (isSacrifice) return 'brilliant';
  return cpLoss === 0 ? 'best' : 'good';
}

/** True for any tier that isn't an error (dubious/mistake/miss/blunder) —
 * the "this move was fine" check used by callers that only cared about the
 * old two-way good/bad split before quality grew brilliant/interesting/
 * best/miss tiers. */
export function isSoundQuality(quality: MoveQuality): boolean {
  return quality !== 'dubious' && quality !== 'mistake' && quality !== 'blunder' && quality !== 'miss';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bestLine(engineEval: EngineEval | undefined): EngineLine | undefined {
  return engineEval?.lines[0];
}

/** The best line's score in white-perspective centipawns, mapping mate scores to +-1000 first. */
export function whitePerspectiveCp(line: EngineLine | undefined): number {
  if (!line) return 0;
  if (line.mateIn !== null) return mateToCp(line.mateIn);
  return line.cp ?? 0;
}

function bestLineSan(engineEval: EngineEval | undefined): string[] {
  const line = bestLine(engineEval);
  return line ? [line.moveSan] : [];
}
