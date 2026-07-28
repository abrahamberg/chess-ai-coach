import { describe, expect, test } from 'vitest';
import {
  decodeAnnotationNote,
  decodePositionContext,
  decodePositionDivider,
  describeAnnotation,
  describePly,
  encodeAnnotationNote,
  encodePositionContext,
  encodePositionDivider,
  sanForPly
} from './positionDivider.js';

describe('positionDivider', () => {
  test('describePly converts a ply into standard chess move-pair number and color', () => {
    expect(describePly(35)).toEqual({ moveNumber: 18, color: 'white' });
    expect(describePly(1)).toEqual({ moveNumber: 1, color: 'white' });
    expect(describePly(2)).toEqual({ moveNumber: 1, color: 'black' });
    expect(describePly(14)).toEqual({ moveNumber: 7, color: 'black' });
  });

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

  test('round-trips arrows/highlights through encode/decode', () => {
    const state = { arrows: [{ from: 'e2', to: 'e4', color: '#c9762a' }], highlights: [{ square: 'd5', color: '#4a7fb5' }] };
    const text = encodeAnnotationNote(state);
    expect(decodeAnnotationNote(text)).toEqual(state);
  });

  test('decodeAnnotationNote returns null for ordinary chat text', () => {
    expect(decodeAnnotationNote('hello coach')).toBeNull();
  });

  test('describeAnnotation renders arrows as "from→to"', () => {
    expect(describeAnnotation({ arrows: [{ from: 'e2', to: 'e4', color: '#c9762a' }], highlights: [] })).toBe('e2→e4');
  });

  test('describeAnnotation joins multiple arrows and mentions highlighted squares', () => {
    expect(
      describeAnnotation({
        arrows: [
          { from: 'e2', to: 'e4', color: '#c9762a' },
          { from: 'd1', to: 'h5', color: '#c9762a' }
        ],
        highlights: [{ square: 'd5', color: '#4a7fb5' }]
      })
    ).toBe('e2→e4, d1→h5; highlighted d5');
  });

  test('encodePositionContext reads as natural language, like [board_move] — the coach receives this verbatim as the user turn', () => {
    const text = encodePositionContext(18, 'bxc3', 'what should I look at here?');
    expect(text).toBe('[position_context] Back at move 9 (black), after bxc3: what should I look at here?');
  });

  test('round-trips move-pair number, color, san, and free-text content through encode/decode', () => {
    const text = encodePositionContext(18, 'bxc3', 'what should I look at here?');
    expect(decodePositionContext(text)).toEqual({
      moveNumber: 9,
      color: 'black',
      san: 'bxc3',
      content: 'what should I look at here?'
    });
  });

  test('decodePositionContext preserves colons inside the content', () => {
    const text = encodePositionContext(1, 'e4', 'what about this: e5?');
    expect(decodePositionContext(text)).toEqual({
      moveNumber: 1,
      color: 'white',
      san: 'e4',
      content: 'what about this: e5?'
    });
  });

  test('decodePositionContext returns null for ordinary chat text', () => {
    expect(decodePositionContext('hello coach')).toBeNull();
  });
});
