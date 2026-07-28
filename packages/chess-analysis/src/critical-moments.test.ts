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

  test('does not flag an opponent mistake/blunder as user_mistake', () => {
    const moves = [move({ ply: 1, isUserMove: false, quality: 'blunder', cpLoss: 500 })];
    const evals = [evalWithLines([line('e4', 0)])];

    expect(findCandidateMoments(moves, evals)).toEqual([]);
  });

  test('flags a missed_chance when the user plays a good move but a >=300cp better line existed', () => {
    const moves = [move({ ply: 1, isUserMove: true, quality: 'good', moveSan: 'Be2', mover: 'white' })];
    // evalBefore (index ply-1=0): best line Nxf7 at +900, second line Be2 at +100 -> gap 800.
    const evals = [evalWithLines([line('Nxf7', 900), line('Be2', 100)])];

    const moments = findCandidateMoments(moves, evals);

    expect(moments).toEqual([{ ply: 1, kind: 'missed_chance', cpLoss: 800 }]);
  });

  test('does not flag missed_chance when the user actually played the top engine line', () => {
    // evalAfterCp matches the starting eval's zone so no incidental turning_point fires.
    const moves = [
      move({ ply: 1, isUserMove: true, quality: 'good', moveSan: 'Nxf7', mover: 'white', evalAfterCp: 900 })
    ];
    const evals = [evalWithLines([line('Nxf7', 900), line('Be2', 100)])];

    expect(findCandidateMoments(moves, evals)).toEqual([]);
  });

  test('does not flag missed_chance when the multiPv gap is below 300cp', () => {
    const moves = [
      move({ ply: 1, isUserMove: true, quality: 'good', moveSan: 'Be2', mover: 'white', evalAfterCp: 200 })
    ];
    const evals = [evalWithLines([line('Nxf7', 200), line('Be2', 100)])];

    expect(findCandidateMoments(moves, evals)).toEqual([]);
  });

  test('does not flag missed_chance when only one multiPv line is available', () => {
    const moves = [
      move({ ply: 1, isUserMove: true, quality: 'good', moveSan: 'Be2', mover: 'white', evalAfterCp: 900 })
    ];
    const evals = [evalWithLines([line('Nxf7', 900)])];

    expect(findCandidateMoments(moves, evals)).toEqual([]);
  });

  test('does not flag missed_chance for a non-good quality move even with a big gap', () => {
    const moves = [
      move({ ply: 1, isUserMove: true, quality: 'dubious', moveSan: 'Be2', mover: 'white', evalAfterCp: 900 })
    ];
    const evals = [evalWithLines([line('Nxf7', 900), line('Be2', 100)])];

    expect(findCandidateMoments(moves, evals)).toEqual([]);
  });

  test('does not flag missed_chance for opponent moves', () => {
    const moves = [
      move({ ply: 1, isUserMove: false, quality: 'good', moveSan: 'Be2', mover: 'black', evalAfterCp: 900 })
    ];
    const evals = [evalWithLines([line('Nxf7', 900), line('Be2', 100)])];

    expect(findCandidateMoments(moves, evals)).toEqual([]);
  });

  test('accounts for the mover perspective flip when computing the missed_chance gap', () => {
    // Black to move; lines are white-perspective cp per this codebase's EngineEval
    // convention, so a large *negative* gap between lines is what's good for black.
    const moves = [move({ ply: 1, isUserMove: true, quality: 'good', moveSan: 'Bxf7', mover: 'black' })];
    const evals = [evalWithLines([line('Nxc2', -900), line('Bxf7', -100)])];

    const moments = findCandidateMoments(moves, evals);

    expect(moments).toEqual([{ ply: 1, kind: 'missed_chance', cpLoss: 800 }]);
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

  test('dedups by ply, preferring user_mistake over missed_chance over turning_point', () => {
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
