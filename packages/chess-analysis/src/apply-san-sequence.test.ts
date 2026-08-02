import { describe, expect, test } from 'vitest';
import { applySanSequence } from './apply-san-sequence.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('applySanSequence', () => {
  test('replays a legal sequence from the starting position', () => {
    const result = applySanSequence(STARTING_FEN, ['e4', 'e5', 'Nf3']);

    expect(result.error).toBeNull();
    expect(result.moves).toEqual([
      { san: 'e4', uci: 'e2e4', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' },
      { san: 'e5', uci: 'e7e5', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' },
      { san: 'Nf3', uci: 'g1f3', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2' }
    ]);
  });

  test('stops at the first illegal SAN and reports a partial result', () => {
    const result = applySanSequence(STARTING_FEN, ['e4', 'Zz9', 'Nf3']);

    expect(result.error).not.toBeNull();
    expect(result.moves).toEqual([
      { san: 'e4', uci: 'e2e4', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' }
    ]);
  });

  test('returns no moves and no error for an empty sequence', () => {
    const result = applySanSequence(STARTING_FEN, []);

    expect(result.error).toBeNull();
    expect(result.moves).toEqual([]);
  });

  test('resolves promotion and castling SAN', () => {
    const promotionFen = '8/P7/8/7k/8/8/8/7K w - - 0 1';
    const promotionResult = applySanSequence(promotionFen, ['a8=Q']);
    expect(promotionResult.error).toBeNull();
    expect(promotionResult.moves).toEqual([{ san: 'a8=Q', uci: 'a7a8q', fen: expect.stringContaining('Q') }]);

    const castlingFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const castlingResult = applySanSequence(castlingFen, ['O-O']);
    expect(castlingResult.error).toBeNull();
    expect(castlingResult.moves).toEqual([{ san: 'O-O', uci: 'e1g1', fen: expect.stringContaining('RK1') }]);
  });

  test('an illegal first move returns an empty partial result with an error', () => {
    const result = applySanSequence(STARTING_FEN, ['Zz9']);

    expect(result.error).not.toBeNull();
    expect(result.moves).toEqual([]);
  });
});
