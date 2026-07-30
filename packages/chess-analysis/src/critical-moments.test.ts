import type { EngineEval, EngineLine } from '@chess-coach/shared';
import { describe, expect, test } from 'vitest';
import type { ClassifiedMove } from './classify.js';
import { findCandidateMoments } from './critical-moments.js';

function move(overrides: Partial<ClassifiedMove> & { ply: number }): ClassifiedMove {
  return {
    moveSan: 'e4',
    mover: 'white',
    isUserMove: true,
    cpLoss: 0,
    quality: 'good',
    bestLineSan: ['e4'],
    evalAfterCp: 0,
    hangsPiece: false,
    ...overrides
  };
}

function line(moveSan: string, cp: number | null, mateIn: number | null = null): EngineLine {
  return { moveUci: 'e2e4', moveSan, cp, mateIn };
}

function evalWithLines(lines: EngineLine[]): EngineEval {
  return { ply: 0, fen: 'irrelevant', depth: 18, lines };
}

describe('findCandidateMoments', () => {
  test('flags every user mistake/blunder', () => {
    const moves = [
      move({ ply: 1, isUserMove: true, quality: 'mistake', cpLoss: 120 }),
      move({ ply: 2, isUserMove: true, quality: 'blunder', cpLoss: 400 }),
      move({ ply: 3, isUserMove: true, quality: 'good', cpLoss: 0 }),
      move({ ply: 4, isUserMove: true, quality: 'dubious', cpLoss: 60 })
    ];
    const evals = [evalWithLines([line('e4', 0)])];

    const moments = findCandidateMoments(moves, evals);

    expect(moments).toEqual([
      { ply: 1, kind: 'user_mistake', cpLoss: 120 },
      { ply: 2, kind: 'user_mistake', cpLoss: 400 }
    ]);
  });

  test('flags a user miss the same as mistake/blunder', () => {
    const moves = [move({ ply: 1, isUserMove: true, quality: 'miss', cpLoss: 200 })];
    const evals = [evalWithLines([line('e4', 0)])];

    expect(findCandidateMoments(moves, evals)).toEqual([{ ply: 1, kind: 'user_mistake', cpLoss: 200 }]);
  });

  test('does not flag an opponent mistake/blunder as user_mistake', () => {
    const moves = [move({ ply: 1, isUserMove: false, quality: 'blunder', cpLoss: 500 })];
    const evals = [evalWithLines([line('e4', 0)])];

    expect(findCandidateMoments(moves, evals)).toEqual([]);
  });

  test('flags a turning_point when the white-perspective eval crosses the +-150cp band', () => {
    const moves = [
      move({ ply: 1, evalAfterCp: 50 }),
      move({ ply: 2, evalAfterCp: 250 }),
      move({ ply: 3, evalAfterCp: 260 })
    ];
    const evals = [evalWithLines([line('e4', 0)])];

    const moments = findCandidateMoments(moves, evals);

    expect(moments).toEqual([{ ply: 2, kind: 'turning_point', cpLoss: 200 }]);
  });

  test('flags a turning_point that skips straight across the middle zone', () => {
    // Starting eval matches move 1's eval (both zone "white ahead") so the only
    // crossing is move 1 -> move 2, which jumps clean across the middle zone.
    const moves = [move({ ply: 1, evalAfterCp: 200 }), move({ ply: 2, evalAfterCp: -200 })];
    const evals = [evalWithLines([line('e4', 200)])];

    const moments = findCandidateMoments(moves, evals);

    expect(moments).toEqual([{ ply: 2, kind: 'turning_point', cpLoss: 400 }]);
  });

  test('considers the starting position eval for a turning_point at ply 1', () => {
    const moves = [move({ ply: 1, evalAfterCp: 300 })];
    const evals = [evalWithLines([line('e4', 0)])];

    const moments = findCandidateMoments(moves, evals);

    expect(moments).toEqual([{ ply: 1, kind: 'turning_point', cpLoss: 300 }]);
  });

  test('does not flag a turning_point that stays within the same zone', () => {
    const moves = [move({ ply: 1, evalAfterCp: 20 }), move({ ply: 2, evalAfterCp: -20 })];
    const evals = [evalWithLines([line('e4', 0)])];

    expect(findCandidateMoments(moves, evals)).toEqual([]);
  });

  test('dedups by ply, preferring user_mistake over turning_point', () => {
    const moves = [move({ ply: 1, isUserMove: true, quality: 'blunder', cpLoss: 500, evalAfterCp: 300 })];
    const evals = [evalWithLines([line('e4', 0)])];

    const moments = findCandidateMoments(moves, evals);

    expect(moments).toEqual([{ ply: 1, kind: 'user_mistake', cpLoss: 500 }]);
  });

  test('results are sorted by ply regardless of which rule produced them', () => {
    const moves = [
      move({ ply: 1, evalAfterCp: 0 }),
      move({ ply: 2, isUserMove: true, quality: 'good', moveSan: 'Be2', mover: 'white', evalAfterCp: 300 }),
      move({ ply: 3, isUserMove: true, quality: 'blunder', cpLoss: 500, evalAfterCp: 300 })
    ];
    const evals = [
      evalWithLines([line('e4', 0)]),
      evalWithLines([line('Nxf7', 900), line('Be2', 100)])
    ];

    const moments = findCandidateMoments(moves, evals);

    expect(moments.map((moment) => moment.ply)).toEqual([2, 3]);
  });

  test('does not cap the number of moments returned', () => {
    const moves = Array.from({ length: 10 }, (_, index) =>
      move({ ply: index + 1, isUserMove: true, quality: 'blunder', cpLoss: 500 })
    );
    const evals = [evalWithLines([line('e4', 0)])];

    expect(findCandidateMoments(moves, evals)).toHaveLength(10);
  });
});
