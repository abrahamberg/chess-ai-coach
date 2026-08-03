import { describe, expect, test } from 'vitest';
import { resolveSanMove } from './resolve-san-move.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('resolveSanMove', () => {
  test('resolves a pawn push to its from/to squares', () => {
    expect(resolveSanMove(STARTING_FEN, 'e4')).toEqual({ from: 'e2', to: 'e4' });
  });

  test('resolves a piece move', () => {
    expect(resolveSanMove(STARTING_FEN, 'Nf3')).toEqual({ from: 'g1', to: 'f3' });
  });

  test('resolves a disambiguated move to the correct source square', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 2 3';
    expect(resolveSanMove(fen, 'Nc3')).toEqual({ from: 'b1', to: 'c3' });
  });

  test('resolves castling to the king\'s squares', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(resolveSanMove(fen, 'O-O')).toEqual({ from: 'e1', to: 'g1' });
  });

  test('returns null for a move that is illegal in the given position', () => {
    expect(resolveSanMove(STARTING_FEN, 'Nf6')).toBeNull();
  });

  test('returns null for malformed SAN', () => {
    expect(resolveSanMove(STARTING_FEN, 'Rxd')).toBeNull();
  });

  test('returns null for an invalid FEN instead of throwing', () => {
    expect(resolveSanMove('not-a-real-fen', 'e4')).toBeNull();
  });
});
