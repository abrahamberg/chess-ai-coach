import { describe, expect, test } from 'vitest';
import { parseBestMove, parseInfoLine } from './uci-info-parser.js';

describe('parseInfoLine', () => {
  test('parses a centipawn score line', () => {
    const line =
      'info depth 1 seldepth 3 multipv 1 score cp 569 nodes 18 nps 18000 hashfull 0 tbhits 0 time 1 pv b1h1';
    expect(parseInfoLine(line)).toEqual({
      multipv: 1,
      cp: 569,
      mateIn: null,
      pvUci: ['b1h1']
    });
  });

  test('parses a mate score line with a multi-move pv', () => {
    const line =
      'info depth 4 seldepth 5 multipv 1 score mate 2 nodes 107 nps 107000 hashfull 0 tbhits 0 time 1 pv b1h1 a8b8 h1h8';
    expect(parseInfoLine(line)).toEqual({
      multipv: 1,
      cp: null,
      mateIn: 2,
      pvUci: ['b1h1', 'a8b8', 'h1h8']
    });
  });

  test('parses a negative mate score (side to move is getting mated)', () => {
    const line = 'info depth 6 multipv 1 score mate -3 nodes 500 time 5 pv a1a2 b2b3 c3c4';
    expect(parseInfoLine(line)).toEqual({
      multipv: 1,
      cp: null,
      mateIn: -3,
      pvUci: ['a1a2', 'b2b3', 'c3c4']
    });
  });

  test('parses multipv 2 lines independently', () => {
    const line =
      'info depth 8 seldepth 10 multipv 2 score cp 42 nodes 900 time 10 pv d2d4 d7d5';
    expect(parseInfoLine(line)).toEqual({
      multipv: 2,
      cp: 42,
      mateIn: null,
      pvUci: ['d2d4', 'd7d5']
    });
  });

  test('returns null for info string lines', () => {
    const line = 'info string NNUE evaluation using nn-c288c895ea92.nnue';
    expect(parseInfoLine(line)).toBeNull();
  });

  test('returns null for lines with no score (e.g. currmove)', () => {
    const line = 'info depth 12 currmove e2e4 currmovenumber 1';
    expect(parseInfoLine(line)).toBeNull();
  });

  test('returns null for bound-limited scores (upperbound/lowerbound)', () => {
    const line = 'info depth 9 multipv 1 score cp 30 upperbound nodes 100 pv e2e4';
    expect(parseInfoLine(line)).toBeNull();
  });

  test('returns null for a non-info line', () => {
    expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull();
  });
});

describe('parseBestMove', () => {
  test('extracts the move from a bestmove line with a ponder move', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
  });

  test('extracts the move from a bestmove line with no ponder move', () => {
    expect(parseBestMove('bestmove h1h8')).toBe('h1h8');
  });

  test('returns null for a non-bestmove line', () => {
    expect(parseBestMove('info depth 1 score cp 10 pv e2e4')).toBeNull();
  });
});
