import type { ParsedPosition } from '@chess-coach/chess-analysis';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useLivePositions } from './useLivePositions.js';

const SEED: ParsedPosition[] = [
  { ply: 0, fen: 'start-fen', moveSan: null, moveUci: null, mover: null },
  { ply: 1, fen: 'after-e4-fen', moveSan: 'e4', moveUci: 'e2e4', mover: 'white' }
];

const PLY_2: ParsedPosition = { ply: 2, fen: 'after-e5-fen', moveSan: 'e5', moveUci: 'e7e5', mover: 'black' };

describe('useLivePositions (architecture §14: play mode)', () => {
  test('starts empty until a seed arrives (the game fetch resolves after mount)', () => {
    const { result, rerender } = renderHook(({ seed }) => useLivePositions(seed), {
      initialProps: { seed: undefined as ParsedPosition[] | undefined }
    });
    expect(result.current.positions).toEqual([]);

    rerender({ seed: SEED });
    expect(result.current.positions).toEqual(SEED);
  });

  test('seeds only once — a later different seed value is ignored, since append/truncate own it after that', () => {
    const { result, rerender } = renderHook(({ seed }) => useLivePositions(seed), {
      initialProps: { seed: SEED as ParsedPosition[] | undefined }
    });
    act(() => {
      result.current.append(PLY_2);
    });
    expect(result.current.positions).toHaveLength(3);

    rerender({ seed: [{ ply: 0, fen: 'a-different-seed', moveSan: null, moveUci: null, mover: null }] });

    expect(result.current.positions).toHaveLength(3);
  });

  test('append grows the array', () => {
    const { result } = renderHook(() => useLivePositions(SEED));

    act(() => {
      result.current.append(PLY_2);
    });

    expect(result.current.positions).toEqual([...SEED, PLY_2]);
  });

  test('truncateTo drops any position past the given ply (undo)', () => {
    const { result } = renderHook(() => useLivePositions(SEED));
    act(() => {
      result.current.append(PLY_2);
    });

    act(() => {
      result.current.truncateTo(1);
    });

    expect(result.current.positions).toEqual([SEED[0], SEED[1]]);
  });
});
