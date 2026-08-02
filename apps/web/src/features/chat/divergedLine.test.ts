import { describe, expect, test } from 'vitest';
import {
  decodeDivergedLine,
  decodeDivergedLineStart,
  encodeDivergedLine,
  encodeDivergedLineStart,
  formatDivergedSanSequence,
  type DivergedLineState
} from './divergedLine.js';

describe('formatDivergedSanSequence', () => {
  test('formats a sequence starting from the game start (basePly 0) with standard move-pair numbering', () => {
    expect(formatDivergedSanSequence(0, [{ san: 'e4' }, { san: 'e5' }, { san: 'Nf3' }])).toBe('1.e4 e5 2.Nf3');
  });

  test('formats a sequence whose first move is black (basePly is an odd/white ply) with the "N..." black-to-move marker', () => {
    expect(formatDivergedSanSequence(1, [{ san: 'e5' }, { san: 'Nf3' }])).toBe('1...e5 2.Nf3');
  });
});

describe('diverged-line start sentinel (client-synthesized, hypothetical_line result)', () => {
  test('round-trips through encode/decode', () => {
    const data = { basePly: 4, sanMoves: ['a4', 'Nf6'], resultFen: 'some-fen' };
    expect(decodeDivergedLineStart(encodeDivergedLineStart(data))).toEqual(data);
  });

  test('decode returns null for ordinary chat text', () => {
    expect(decodeDivergedLineStart('hello coach')).toBeNull();
  });
});

describe('diverged-line message (student-submitted, becomes the actual user turn)', () => {
  const LINE: DivergedLineState = {
    basePly: 25,
    baseFen: 'base-fen',
    moves: [
      { san: 'a3', fen: 'fen-1', uci: 'a2a3' },
      { san: 'f6', fen: 'fen-2', uci: 'f7f6' },
      { san: 'a4', fen: 'fen-3', uci: 'a3a4' }
    ]
  };

  test('reads as natural language, like [board_move]/[position_context]', () => {
    const text = encodeDivergedLine(LINE, 'what if instead?');
    expect(text).toBe(
      '[diverged_line] Exploring from move 13 (black): 13...a3 14.f6 a4 (position now: fen-3): what if instead?'
    );
  });

  test('round-trips basePly, the SAN sequence, the resulting fen, and free-text content', () => {
    const text = encodeDivergedLine(LINE, 'what if instead?');
    expect(decodeDivergedLine(text)).toEqual({
      basePly: 25,
      sanText: '13...a3 14.f6 a4',
      resultFen: 'fen-3',
      content: 'what if instead?'
    });
  });

  test('preserves colons inside the free-text content', () => {
    const text = encodeDivergedLine(LINE, 'what about this: a5?');
    expect(decodeDivergedLine(text)?.content).toBe('what about this: a5?');
  });

  test('decode returns null for ordinary chat text', () => {
    expect(decodeDivergedLine('hello coach')).toBeNull();
  });
});
