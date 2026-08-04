import { describe, expect, test } from 'vitest';
import { diffPositionFeatures } from './diff-features.js';
import { computePositionFeatures } from './position-features.js';

const QUIET_FEN = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
// Knight on d5 forks the rook on b6 and knight on f6 — see
// position-features.test.ts's identical fixture for the fork itself.
const FORK_FEN = '4k3/8/1r3n2/3N4/8/8/8/7K w - - 0 1';
// Queen on d1 hanging to the rook on d8 down the open file.
const HANGING_QUEEN_FEN = '3rk3/8/8/8/8/8/8/3Q3K w - - 0 1';

describe('diffPositionFeatures', () => {
  test('reports a fork present after but not before', () => {
    const delta = diffPositionFeatures(computePositionFeatures(QUIET_FEN), computePositionFeatures(FORK_FEN));
    expect(delta.newForks).toHaveLength(1);
    expect(delta.newForks[0]).toMatchObject({ square: 'd5', piece: 'n' });
  });

  test('reports a hanging piece present after but not before', () => {
    const delta = diffPositionFeatures(computePositionFeatures(QUIET_FEN), computePositionFeatures(HANGING_QUEEN_FEN));
    expect(delta.newHangingPieces).toEqual([{ square: 'd1', piece: 'q', color: 'white', attackers: 1, defenders: 0 }]);
    expect(delta.newForks).toEqual([]);
  });

  test('does not re-report a fork present in both before and after', () => {
    const delta = diffPositionFeatures(computePositionFeatures(FORK_FEN), computePositionFeatures(FORK_FEN));
    expect(delta.newForks).toEqual([]);
    expect(delta.newHangingPieces).toEqual([]);
    expect(delta.mobilityDelta).toBe(0);
  });

  test('mobilityDelta reflects the change in the number of legal moves for the side to move', () => {
    // Starting position (20 legal moves for White) vs. the quiet two-king
    // fixture (White king on e1 has only 5 legal moves).
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const delta = diffPositionFeatures(computePositionFeatures(START_FEN), computePositionFeatures(QUIET_FEN));
    expect(delta.mobilityDelta).toBe(
      computePositionFeatures(QUIET_FEN).availableMoves.length - 20
    );
    expect(delta.mobilityDelta).toBeLessThan(0);
  });
});
