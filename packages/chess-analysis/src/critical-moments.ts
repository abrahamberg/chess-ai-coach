import type { EngineEval } from '@chess-coach/shared';
import type { ClassifiedMove } from './classify.js';
import { whitePerspectiveCp } from './classify.js';

const TURNING_POINT_THRESHOLD_CP = 150;

export type CandidateMomentKind = 'user_mistake' | 'turning_point';

export interface CandidateMoment {
  ply: number;
  kind: CandidateMomentKind;
  cpLoss: number;
}

const KIND_PRIORITY: Record<CandidateMomentKind, number> = {
  user_mistake: 2,
  turning_point: 1
};

/**
 * Finds candidate critical-moment plies for the analysis-planner LLM to
 * prioritize (specs.md §4.2.3 rules a and c; rule b's former multiPv
 * line-gap detection was folded into classify.ts's `miss` quality tier as
 * of the 2026-07-30 threshold-retuning spec -- any move it would have
 * flagged is already tagged `miss` and reaches the planner via rule a
 * instead. Rule d, planner-selected instructive moments with no eval swing,
 * is the LLM's job, not this pure function's).
 *
 * `evals[i]` is the engine evaluation of the position at `moves[i - 1]`'s
 * "before" state (index-aligned the same way as `classifyMoves`), needed
 * here for `turningPointMoments`'s starting-position eval.
 *
 * Not capped -- the planner prioritizes among however many are found. One
 * moment per ply: when multiple rules fire on the same ply, user_mistake
 * wins over turning_point.
 */
export function findCandidateMoments(moves: ClassifiedMove[], evals: EngineEval[]): CandidateMoment[] {
  const byPly = new Map<number, CandidateMoment>();
  addAll(byPly, userMistakeMoments(moves));
  addAll(byPly, turningPointMoments(moves, evals));
  return [...byPly.values()].sort((a, b) => a.ply - b.ply);
}

function addAll(byPly: Map<number, CandidateMoment>, moments: CandidateMoment[]): void {
  for (const moment of moments) addIfHigherPriority(byPly, moment);
}

function addIfHigherPriority(byPly: Map<number, CandidateMoment>, moment: CandidateMoment): void {
  const existing = byPly.get(moment.ply);
  if (existing && KIND_PRIORITY[existing.kind] >= KIND_PRIORITY[moment.kind]) return;
  byPly.set(moment.ply, moment);
}

/** Rule (a): every mistake/blunder/miss the user played. */
function userMistakeMoments(moves: ClassifiedMove[]): CandidateMoment[] {
  return moves
    .filter(
      (move) =>
        move.isUserMove && (move.quality === 'mistake' || move.quality === 'blunder' || move.quality === 'miss')
    )
    .map((move): CandidateMoment => ({ ply: move.ply, kind: 'user_mistake', cpLoss: move.cpLoss }));
}

/** Rule (c): plies where the white-perspective eval crosses the +-150cp band. */
function turningPointMoments(moves: ClassifiedMove[], evals: EngineEval[]): CandidateMoment[] {
  const cpSequence = [startingCp(evals), ...moves.map((move) => move.evalAfterCp)];
  const moments: CandidateMoment[] = [];
  for (let index = 1; index < cpSequence.length; index++) {
    const previousCp = cpSequence[index - 1];
    const currentCp = cpSequence[index];
    const move = moves[index - 1];
    if (previousCp === undefined || currentCp === undefined || !move) continue;
    if (zoneFor(previousCp) === zoneFor(currentCp)) continue;
    moments.push({ ply: move.ply, kind: 'turning_point', cpLoss: Math.abs(currentCp - previousCp) });
  }
  return moments;
}

function startingCp(evals: EngineEval[]): number {
  return whitePerspectiveCp(evals[0]?.lines[0]);
}

function zoneFor(cp: number): -1 | 0 | 1 {
  if (cp > TURNING_POINT_THRESHOLD_CP) return 1;
  if (cp < -TURNING_POINT_THRESHOLD_CP) return -1;
  return 0;
}
