import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { resolveTestStockfishPath } from '../test/helpers/stockfish-path.js';
import { EnginePool } from './engine-pool.js';
import { UciEngine } from './uci.js';

const STOCKFISH_PATH = resolveTestStockfishPath();
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('EnginePool', () => {
  let pool: EnginePool;

  beforeAll(() => {
    pool = new EnginePool(1, () => new UciEngine({ stockfishPath: STOCKFISH_PATH }));
  });

  afterAll(async () => {
    await pool.quitAll();
  });

  test('serializes calls beyond the pool size', async () => {
    const events: string[] = [];

    const run = (label: string) =>
      pool.withEngine(async (engine) => {
        events.push(`${label}:start`);
        await engine.analyze(START_FEN, { depth: 12, multiPv: 1 });
        events.push(`${label}:end`);
      });

    await Promise.all([run('a'), run('b')]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  }, 20000);
});
