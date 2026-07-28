import type { EngineEval, EngineLine, MoveQuality } from '@chess-coach/shared';
import type { ParsedGame } from './pgn.js';

const MATE_CP = 1000;
const INACCURACY_THRESHOLD_CP = 50;
const MISTAKE_THRESHOLD_CP = 100;
const BLUNDER_THRESHOLD_CP = 300;

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
    return classifyMove(position, evalBefore, evalAfter, userColor);
  });
}

function classifyMove(
  position: ParsedGame['positions'][number],
  evalBefore: EngineEval | undefined,
  evalAfter: EngineEval | undefined,
  userColor: 'white' | 'black'
): ClassifiedMove {
  const mover = position.mover ?? 'white';
  const bestCp = toMoverPerspective(whitePerspectiveCp(bestLine(evalBefore)), mover);
  const playedCp = toMoverPerspective(whitePerspectiveCp(bestLine(evalAfter)), mover);
  const cpLoss = clamp(bestCp - playedCp, 0, MATE_CP);

  return {
    ply: position.ply,
    moveSan: position.moveSan ?? '',
    mover,
    isUserMove: mover === userColor,
    cpLoss,
    quality: qualityFor(cpLoss),
    bestLineSan: bestLineSan(evalBefore),
    evalAfterCp: whitePerspectiveCp(bestLine(evalAfter))
  };
}

/** Converts a white-perspective centipawn score to the given mover's perspective. */
function toMoverPerspective(whiteCp: number, mover: 'white' | 'black'): number {
  return mover === 'white' ? whiteCp : -whiteCp;
}

/** Maps a mate-in-N score to a white-perspective centipawn value: +N (white mates) -> +1000, -N (black mates) -> -1000. */
function mateToCp(mateIn: number): number {
  return mateIn > 0 ? MATE_CP : -MATE_CP;
}

/** Bucket a non-negative centipawn loss into a move quality per the fixed thresholds. */
export function qualityFor(cpLoss: number): MoveQuality {
  if (cpLoss >= BLUNDER_THRESHOLD_CP) return 'blunder';
  if (cpLoss >= MISTAKE_THRESHOLD_CP) return 'mistake';
  if (cpLoss >= INACCURACY_THRESHOLD_CP) return 'inaccuracy';
  return 'good';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bestLine(engineEval: EngineEval | undefined): EngineLine | undefined {
  return engineEval?.lines[0];
}

/** The best line's score in white-perspective centipawns, mapping mate scores to +-1000 first. */
function whitePerspectiveCp(line: EngineLine | undefined): number {
  if (!line) return 0;
  if (line.mateIn !== null) return mateToCp(line.mateIn);
  return line.cp ?? 0;
}

function bestLineSan(engineEval: EngineEval | undefined): string[] {
  const line = bestLine(engineEval);
  return line ? [line.moveSan] : [];
}
