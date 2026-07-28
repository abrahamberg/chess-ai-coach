import { describe, expect, test } from 'vitest';
import type { EngineLine } from '@chess-coach/shared';
import { analyzeGame, analyzePosition, InvalidFenError } from './analyze.js';
import { EnginePool } from './engine-pool.js';
import { UciEngine, type AnalyzeOptions } from './uci.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

class FakeUciEngine extends UciEngine {
  constructor(private readonly impl: (fen: string, options: AnalyzeOptions) => Promise<EngineLine[]>) {
    super();
  }

  override analyze(fen: string, options: AnalyzeOptions = {}): Promise<EngineLine[]> {
    return this.impl(fen, options);
  }
}

function poolReturning(line: EngineLine): EnginePool {
  return new EnginePool(1, () => new FakeUciEngine(() => Promise.resolve([line])));
}

const bestLine: EngineLine = { moveUci: 'e2e4', moveSan: 'e4', cp: 30, mateIn: null };

describe('analyzePosition', () => {
  test('returns an EngineEval with the given ply, fen, and depth', async () => {
    const pool = poolReturning(bestLine);

    const result = await analyzePosition(pool, START_FEN, 3, { depth: 14 });

    expect(result).toEqual({ ply: 3, fen: START_FEN, depth: 14, lines: [bestLine] });
  });

  test('throws InvalidFenError for a malformed fen without calling the engine', async () => {
    let called = false;
    const pool = new EnginePool(1, () => new FakeUciEngine(() => {
      called = true;
      return Promise.resolve([bestLine]);
    }));

    await expect(analyzePosition(pool, 'not-a-fen', 0, { depth: 10 })).rejects.toThrow(InvalidFenError);
    expect(called).toBe(false);
  });

  test('forwards depth, multiPv, and timeoutMs to the engine', async () => {
    const seen: AnalyzeOptions[] = [];
    const pool = new EnginePool(1, () => new FakeUciEngine((_fen, options) => {
      seen.push(options);
      return Promise.resolve([bestLine]);
    }));

    await analyzePosition(pool, START_FEN, 0, { depth: 10, multiPv: 3, timeoutMs: 2000 });

    expect(seen).toEqual([{ depth: 10, multiPv: 3, timeoutMs: 2000 }]);
  });
});

describe('analyzeGame', () => {
  test('analyzes each fen sequentially, assigning ply by array index', async () => {
    const fens = [START_FEN, AFTER_E4_FEN];
    const seenFens: string[] = [];
    const pool = new EnginePool(1, () => new FakeUciEngine((fen) => {
      seenFens.push(fen);
      return Promise.resolve([bestLine]);
    }));

    const evals = await analyzeGame(pool, fens, { depth: 8 });

    expect(evals.map((e) => e.ply)).toEqual([0, 1]);
    expect(evals.map((e) => e.fen)).toEqual(fens);
    expect(seenFens).toEqual(fens);
  });

  test('rejects with InvalidFenError if any fen is malformed', async () => {
    const pool = poolReturning(bestLine);

    await expect(analyzeGame(pool, [START_FEN, 'garbage'], { depth: 8 })).rejects.toThrow(
      InvalidFenError
    );
  });
});
