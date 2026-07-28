import { describe, expect, test } from 'vitest';
import { decodePositionDivider, encodePositionDivider, sanForPly } from './positionDivider.js';

describe('positionDivider', () => {
  test('round-trips ply and san through encode/decode', () => {
    const text = encodePositionDivider(14, 'Bg4');
    expect(decodePositionDivider(text)).toEqual({ ply: 14, san: 'Bg4' });
  });

  test('decode returns null for ordinary chat text', () => {
    expect(decodePositionDivider('hello coach')).toBeNull();
  });

  test('sanForPly looks up the move that reached a ply (1-indexed offset)', () => {
    const sanMoves = ['e4', 'e5', 'Nf3'];
    expect(sanForPly(sanMoves, 1)).toBe('e4');
    expect(sanForPly(sanMoves, 3)).toBe('Nf3');
  });

  test('sanForPly returns null for ply 0 (start position, no preceding move)', () => {
    expect(sanForPly(['e4'], 0)).toBeNull();
  });
});
