export interface MoveRef {
  moveNumber: number;
  color: 'white' | 'black' | null;
}

/**
 * Converts a ply (half-move count, 1-indexed; 0 = the game's starting
 * position, before any move) into the standard chess move-pair reference a
 * human says out loud ("White's move 2", "Black's move 2") — never a bare
 * ply number, which is not standard PGN terminology and is where
 * LLM-driven navigation historically got miscounted.
 */
export function plyToMoveRef(ply: number): MoveRef {
  if (ply === 0) return { moveNumber: 0, color: null };
  return {
    moveNumber: Math.ceil(ply / 2),
    color: ply % 2 === 1 ? 'white' : 'black'
  };
}

/** Inverse of {@link plyToMoveRef}. */
export function moveRefToPly(moveNumber: number, color: 'white' | 'black' | null): number {
  if (moveNumber === 0) return 0;
  return color === 'white' ? moveNumber * 2 - 1 : moveNumber * 2;
}
