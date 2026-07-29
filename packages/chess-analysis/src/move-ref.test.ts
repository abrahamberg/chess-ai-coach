import { describe, expect, test } from 'vitest';
import { moveRefToPly, plyToMoveRef } from './move-ref.js';

describe('plyToMoveRef', () => {
  test('ply 1 (e4) is White move 1', () => {
    expect(plyToMoveRef(1)).toEqual({ moveNumber: 1, color: 'white' });
  });

  test('ply 2 (e5) is Black move 1', () => {
    expect(plyToMoveRef(2)).toEqual({ moveNumber: 1, color: 'black' });
  });

  test('ply 3 (d4, the position discussed in the bug report) is White move 2', () => {
    expect(plyToMoveRef(3)).toEqual({ moveNumber: 2, color: 'white' });
  });

  test('ply 4 (d5) is Black move 2', () => {
    expect(plyToMoveRef(4)).toEqual({ moveNumber: 2, color: 'black' });
  });
});

describe('moveRefToPly', () => {
  test('White move 1 is ply 1', () => {
    expect(moveRefToPly(1, 'white')).toBe(1);
  });

  test('Black move 1 is ply 2', () => {
    expect(moveRefToPly(1, 'black')).toBe(2);
  });

  test('White move 2 is ply 3', () => {
    expect(moveRefToPly(2, 'white')).toBe(3);
  });

  test('is the exact inverse of plyToMoveRef for plies 1-20', () => {
    for (let ply = 1; ply <= 20; ply++) {
      const ref = plyToMoveRef(ply);
      expect(moveRefToPly(ref.moveNumber, ref.color)).toBe(ply);
    }
  });
});

describe('ply 0 (the game start, before any move)', () => {
  test('plyToMoveRef(0) has no mover', () => {
    expect(plyToMoveRef(0)).toEqual({ moveNumber: 0, color: null });
  });

  test('moveRefToPly(0, null) is ply 0', () => {
    expect(moveRefToPly(0, null)).toBe(0);
  });
});
