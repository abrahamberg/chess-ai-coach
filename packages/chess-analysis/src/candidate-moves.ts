import type { AttackedPieceDto } from '@chess-coach/shared';
import { applySanSequence } from './apply-san-sequence.js';
import { diffPositionFeatures } from './diff-features.js';
import { computePositionFeatures } from './position-features.js';

export interface CandidateMoveAnnotation {
  moveSan: string;
  createsFork: boolean;
  createsHangingPiece: boolean;
  createsUnderDefendedPiece: boolean;
  mobilityDelta: number;
}

function underDefendedPieceKey(piece: AttackedPieceDto): string {
  return `${piece.square}:${piece.piece}:${piece.color}`;
}

/**
 * Annotates each candidate SAN move (e.g. moves the coach is considering
 * suggesting) with the concrete tactical consequences of playing it from
 * `fenBefore` — reusing applySanSequence/computePositionFeatures/
 * diffPositionFeatures rather than re-deriving move application or tactic
 * detection here. Illegal candidates are silently omitted rather than
 * thrown, since the caller may be probing engine-suggested SAN strings it
 * hasn't otherwise validated.
 */
export function annotateCandidateMoves(fenBefore: string, candidateSanMoves: string[]): CandidateMoveAnnotation[] {
  const featuresBefore = computePositionFeatures(fenBefore);
  const underDefendedBeforeKeys = new Set(featuresBefore.underDefendedPieces.map(underDefendedPieceKey));

  const annotations: CandidateMoveAnnotation[] = [];
  for (const moveSan of candidateSanMoves) {
    const applied = applySanSequence(fenBefore, [moveSan]);
    if (applied.error !== null) continue;

    const fenAfter = applied.moves[0]?.fen;
    if (fenAfter === undefined) continue;

    const featuresAfter = computePositionFeatures(fenAfter);
    const delta = diffPositionFeatures(featuresBefore, featuresAfter);
    const createsUnderDefendedPiece = featuresAfter.underDefendedPieces.some(
      (piece) => !underDefendedBeforeKeys.has(underDefendedPieceKey(piece))
    );

    annotations.push({
      moveSan,
      createsFork: delta.newForks.length > 0,
      createsHangingPiece: delta.newHangingPieces.length > 0,
      createsUnderDefendedPiece,
      mobilityDelta: delta.mobilityDelta
    });
  }

  return annotations;
}
