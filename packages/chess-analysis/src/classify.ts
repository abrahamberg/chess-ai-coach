import { Chess } from 'chess.js';
import type { EngineEval, EngineLine, MoveQuality } from '@chess-coach/shared';
import type { ParsedGame } from './pgn.js';

const MATE_CP = 1000;
const INTERESTING_EP = 0.05;
const DUBIOUS_EP = 0.1;
const MISTAKE_EP = 0.2;
const BLUNDER_EP = 0.3;
const MISS_GAP_CP = 300;

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
  hangsPiece: boolean;
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
  const epLoss = clamp(expectedPoints(bestCp) - expectedPoints(playedCp), 0, 1);
  const sacrifice =
    fenBefore !== undefined && position.moveSan !== null && isSacrifice(fenBefore, position.moveSan);
  const hangs = fenBefore !== undefined && position.moveSan !== null && hangsPiece(fenBefore, position.moveSan);
  const isMiss = computeIsMiss(evalBefore, position.moveSan, mover, bestCp, deliveredMate);

  return {
    ply: position.ply,
    moveSan: position.moveSan ?? '',
    mover,
    isUserMove: mover === userColor,
    cpLoss,
    quality: qualityFor(cpLoss, epLoss, sacrifice, isMiss),
    bestLineSan: bestLineSan(evalBefore),
    evalAfterCp: whitePerspectiveCp(bestLine(evalAfter)),
    hangsPiece: hangs
  };
}

/** True multi-PV "miss": the pre-move position had a much better line
 * (>=MISS_GAP_CP better, mover perspective) than the one actually played,
 * and the mover didn't deliver mate instead (which would otherwise
 * spuriously trigger this via the mate-vs-non-mate cp gap, even though
 * delivering mate is definitionally the best possible outcome). */
function computeIsMiss(
  evalBefore: EngineEval | undefined,
  playedSan: string | null,
  mover: 'white' | 'black',
  bestCp: number,
  deliveredMate: boolean
): boolean {
  if (deliveredMate) return false;
  const lines = evalBefore?.lines ?? [];
  const bestMoveSan = lines[0]?.moveSan;
  const secondLine = lines[1];
  if (bestMoveSan === undefined || secondLine === undefined || playedSan === bestMoveSan) return false;
  const secondBestCp = toMoverPerspective(whitePerspectiveCp(secondLine), mover);
  return bestCp - secondBestCp >= MISS_GAP_CP;
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

/** Best-effort "left a piece hanging" signal: true when the piece that just
 * moved lands on a square the opponent attacks with nothing of the mover's
 * own defending it. Simpler than isSacrifice -- no equal-or-lesser-attacker
 * comparison, no capture exclusion (a bad recapture that hangs the
 * recapturing piece still counts) -- and, like isSacrifice, only looks one
 * ply deep at the moved piece itself, not the whole board or later plies. */
export function hangsPiece(fenBefore: string, moveSan: string): boolean {
  const chess = new Chess(fenBefore);
  let move;
  try {
    move = chess.move(moveSan);
  } catch {
    return false;
  }
  if (!move || move.piece === 'p' || move.piece === 'k') return false;

  const opponentColor = move.color === 'w' ? 'b' : 'w';
  if (!chess.isAttacked(move.to, opponentColor)) return false;
  return !chess.isAttacked(move.to, move.color);
}

/** Converts a white-perspective centipawn score to the given mover's perspective. */
export function toMoverPerspective(whiteCp: number, mover: 'white' | 'black'): number {
  return mover === 'white' ? whiteCp : -whiteCp;
}

/** Converts a mover-perspective centipawn score to that mover's expected
 * points (0-1) via the standard logistic win-probability curve (the same
 * conversion chess.com/Lichess-adjacent tooling uses). Symmetric around
 * cp=0 (0.5) and monotonic; mate scores arrive pre-clamped to +-MATE_CP by
 * whitePerspectiveCp/mateToCp, so they saturate near 0/1 rather than
 * exploding. */
export function expectedPoints(cp: number): number {
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

/** Maps a mate-in-N score to a white-perspective centipawn value: +N (white mates) -> +1000, -N (black mates) -> -1000. */
function mateToCp(mateIn: number): number {
  return mateIn > 0 ? MATE_CP : -MATE_CP;
}

/**
 * Buckets a move into a quality tier using Expected-Points-loss (`epLoss`,
 * 0-1, via `expectedPoints`) as the primary signal, plus two overrides:
 * `isSacrifice` (unchanged detection, gated to low epLoss) and `isMiss`
 * (true multi-PV "you had a much better line and didn't play it" signal,
 * which overrides the ladder result entirely -- see `classifyMove`).
 *
 * `cpLoss === 0` is the one exception that stays cp-based rather than
 * EP-based: it is the exact "played the engine's own top choice" case, and
 * using raw cp for it sidesteps any floating-point-equality concerns from
 * the EP conversion.
 */
export function qualityFor(cpLoss: number, epLoss: number, isSacrifice = false, isMiss = false): MoveQuality {
  if (isMiss) return 'miss';
  if (epLoss >= BLUNDER_EP) return 'blunder';
  if (epLoss >= MISTAKE_EP) return 'mistake';
  if (epLoss >= DUBIOUS_EP) return 'dubious';
  if (epLoss >= INTERESTING_EP) return 'interesting';
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
