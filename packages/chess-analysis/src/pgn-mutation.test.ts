import { describe, expect, test } from 'vitest';
import { appendMoveToPgn, removeLastMoveFromPgn } from './pgn-mutation.js';

const EMPTY_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

*`;

const ONE_MOVE_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. e4 *`;

const TWO_MOVE_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. e4 e5 *`;

const CHECKMATE_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

describe('appendMoveToPgn', () => {
  test('applies a legal move to an empty (header-only) PGN', () => {
    const result = appendMoveToPgn(EMPTY_PGN, 'e4');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.san).toBe('e4');
    expect(result.uci).toBe('e2e4');
    expect(result.ply).toBe(1);
    expect(result.fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(result.pgn).toContain('1. e4');
  });

  test('applies a legal move to a PGN that already has moves, incrementing ply', () => {
    const result = appendMoveToPgn(ONE_MOVE_PGN, 'e5');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.san).toBe('e5');
    expect(result.uci).toBe('e7e5');
    expect(result.ply).toBe(2);
    expect(result.pgn).toContain('1. e4 e5');
  });

  test('preserves existing White/Black/Result headers across an append', () => {
    const result = appendMoveToPgn(ONE_MOVE_PGN, 'e5');

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.pgn).toContain('[White "Alice"]');
    expect(result.pgn).toContain('[Black "Bob"]');
    expect(result.pgn).toContain('[Result "*"]');
  });

  test('an illegal SAN returns an error and does not mutate the position', () => {
    const result = appendMoveToPgn(EMPTY_PGN, 'Zz9');

    expect(result).toEqual({ error: 'Illegal move: Zz9' });
  });

  test('an illegal SAN on a PGN with existing moves leaves that PGN reproducible unchanged (error, no partial move)', () => {
    const result = appendMoveToPgn(ONE_MOVE_PGN, 'Zz9');

    expect(result).toEqual({ error: 'Illegal move: Zz9' });
  });
});

describe('removeLastMoveFromPgn', () => {
  test('undoes the only move in a 1-move PGN back to the starting position', () => {
    const result = removeLastMoveFromPgn(ONE_MOVE_PGN);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  test('undoing then appending a different move genuinely rewinds the position, not just cosmetically', () => {
    const undone = removeLastMoveFromPgn(TWO_MOVE_PGN);
    expect('error' in undone).toBe(false);
    if ('error' in undone) return;

    const reappended = appendMoveToPgn(undone.pgn, 'c5');
    expect('error' in reappended).toBe(false);
    if ('error' in reappended) return;
    expect(reappended.san).toBe('c5');
    expect(reappended.fen).toBe('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  });

  test('returns an error when there is no move to undo', () => {
    const result = removeLastMoveFromPgn(EMPTY_PGN);

    expect(result).toEqual({ error: 'no move to undo' });
  });

  test('undoes the final move of a checkmate-ending PGN', () => {
    const result = removeLastMoveFromPgn(CHECKMATE_PGN);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.fen).toBe('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
  });
});
