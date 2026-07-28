import { describe, expect, test } from 'vitest';
import { buildInterpreterMessages } from './engine-interpreter.js';

describe('buildInterpreterMessages', () => {
  test('system prompt matches prompts.md §4.1 and never mentions centipawns', () => {
    const { system } = buildInterpreterMessages({
      fen: 'startpos',
      depth: 18,
      multiPv: 2,
      engineLines: '1. Nxd5 (+1.8): Nxd5 exd5 Qxd5',
      question: 'is Nxd5 sound?'
    });

    expect(system).toContain('AT MOST 80 words');
    expect(system).toContain('never centipawn numbers');
  });

  test('user message embeds fen, depth, multiPv, engine lines, and the question', () => {
    const { user } = buildInterpreterMessages({
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      depth: 18,
      multiPv: 2,
      engineLines: '1. Nxd5 (+1.8): Nxd5 exd5 Qxd5',
      question: 'is Nxd5 sound here, and what is the refutation if not?'
    });

    expect(user).toContain('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
    expect(user).toContain('depth 18');
    expect(user).toContain('top 2');
    expect(user).toContain('1. Nxd5 (+1.8): Nxd5 exd5 Qxd5');
    expect(user).toContain('is Nxd5 sound here, and what is the refutation if not?');
  });
});
