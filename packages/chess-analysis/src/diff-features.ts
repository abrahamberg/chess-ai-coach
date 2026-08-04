import type { AttackedPieceDto, ForkSchema, PositionFeatures } from '@chess-coach/shared';
import type { z } from 'zod';

export type Fork = z.infer<typeof ForkSchema>;

export interface FeatureDelta {
  /** Forks present after but not before (by square+piece — a fork "moving"
   * counts as a new one, which is fine for a coaching callout). */
  newForks: Fork[];
  /** Hanging pieces present after but not before. */
  newHangingPieces: AttackedPieceDto[];
  /** after.availableMoves.length - before.availableMoves.length. */
  mobilityDelta: number;
}

function forkKey(fork: Fork): string {
  return `${fork.square}:${fork.piece}`;
}

function hangingPieceKey(piece: AttackedPieceDto): string {
  return `${piece.square}:${piece.piece}:${piece.color}`;
}

/**
 * Pure diff between two PositionFeatures — used to summarize what concretely
 * changed on the board between two hypothetical/actual resulting positions
 * (e.g. after the engine's best move vs. after the move actually played),
 * rather than dumping both full feature sets for the reader to compare by
 * hand. Deliberately narrow: only the signals a coaching callout needs
 * (new forks, new hanging pieces, mobility swing), not an exhaustive
 * field-by-field diff.
 */
export function diffPositionFeatures(before: PositionFeatures, after: PositionFeatures): FeatureDelta {
  const beforeForkKeys = new Set(before.forks.map(forkKey));
  const beforeHangingKeys = new Set(before.hangingPieces.map(hangingPieceKey));

  return {
    newForks: after.forks.filter((fork) => !beforeForkKeys.has(forkKey(fork))),
    newHangingPieces: after.hangingPieces.filter((piece) => !beforeHangingKeys.has(hangingPieceKey(piece))),
    mobilityDelta: after.availableMoves.length - before.availableMoves.length
  };
}
