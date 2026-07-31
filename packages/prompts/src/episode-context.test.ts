import { describe, expect, test } from 'vitest';
import type { ClassifiedMove } from '@chess-coach/chess-analysis';
import { renderAnnotatedPgn, renderCurrentMoveBlock, renderOtherMovesSummary } from './episode-context.js';

function move(overrides: Partial<ClassifiedMove> & Pick<ClassifiedMove, 'ply' | 'moveSan' | 'quality'>): ClassifiedMove {
  return {
    mover: overrides.ply % 2 === 1 ? 'white' : 'black',
    isUserMove: true,
    cpLoss: 0,
    bestLineSan: [],
    evalAfterCp: 0,
    hangsPiece: false,
    ...overrides
  };
}

describe('renderAnnotatedPgn', () => {
  test('no moves renders a fallback under the heading', () => {
    expect(renderAnnotatedPgn([])).toBe('## This game (annotated)\n\n(no moves)');
  });

  test('sound moves (good/best) get only the quality symbol, no extra detail', () => {
    const moves = [
      move({ ply: 1, moveSan: 'e4', quality: 'best' }),
      move({ ply: 2, moveSan: 'e5', quality: 'good' })
    ];
    expect(renderAnnotatedPgn(moves)).toBe('## This game (annotated)\n\n1.e4★ e5!');
  });

  test('unsound moves (mistake/blunder/miss/dubious) get cpLoss and the best line inline', () => {
    // ply 17 = White's move 9 (odd ply); an odd ply is what carries the "N."
    // prefix — the fixture must use an odd ply for the "9." to appear at all.
    const moves = [move({ ply: 17, moveSan: 'Bg4', quality: 'mistake', cpLoss: 180, bestLineSan: ['h6', 'Bh4'] })];
    expect(renderAnnotatedPgn(moves)).toBe('## This game (annotated)\n\n9.Bg4? (lost ~180cp, best h6)');
  });
});

describe('renderOtherMovesSummary', () => {
  test('no notes renders a fallback under the heading', () => {
    expect(renderOtherMovesSummary([], [])).toBe(
      '## Other moves discussed\n\n(nothing discussed yet outside the current move)'
    );
  });

  test('one line per note, oldest first, with the quality tag when known', () => {
    const notes = [{ ply: 35, note: 'missed Rxd5, assigned as homework' }];
    const qualities = [{ ply: 35, quality: 'blunder' as const }];
    expect(renderOtherMovesSummary(notes, qualities)).toBe(
      "## Other moves discussed\n\n- White's move 18 (blunder): missed Rxd5, assigned as homework"
    );
  });

  test('a note with no matching classified move omits the quality tag', () => {
    const notes = [{ ply: 4, note: 'student asked about the opening name' }];
    expect(renderOtherMovesSummary(notes, [])).toBe(
      "## Other moves discussed\n\n- Black's move 2: student asked about the opening name"
    );
  });
});

describe('renderCurrentMoveBlock', () => {
  test('the first episode of a session has no "reached from" sentence', () => {
    const text = renderCurrentMoveBlock(0, 'startpos-fen', null);
    expect(text).toContain('You are now discussing the game start');
    expect(text).not.toContain('You reached this position from');
  });

  test('a jump includes where the coach/student arrived from', () => {
    const text = renderCurrentMoveBlock(35, 'fen-after-18', 8);
    expect(text).toContain("You are now discussing White's move 18");
    expect(text).toContain('FEN: fen-after-18');
    expect(text).toContain("You reached this position from Black's move 4");
  });
});
