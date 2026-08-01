import { afterAll, describe, expect, test } from 'vitest';
import { resolveTestStockfishPath } from '../test/helpers/stockfish-path.js';
import { buildServer } from './server.js';
import { UciEngine } from './uci.js';

const STOCKFISH_PATH = resolveTestStockfishPath();
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

describe('engine http server', () => {
  const app = buildServer({
    poolSize: 1,
    defaultDepth: 6,
    moveTimeoutMs: 5000,
    engineFactory: () => new UciEngine({ stockfishPath: STOCKFISH_PATH })
  });

  afterAll(async () => {
    await app.close();
  });

  test('GET /health reports pool status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', poolSize: 1, busy: 0 });
  });

  test('POST /analyze-position returns a rich analysis using the configured default depth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/analyze-position',
      payload: { fen: START_FEN }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.analysis.fen).toBe(START_FEN);
    expect(body.analysis.depth).toBe(6);
    expect(body.analysis.lines.length).toBeGreaterThan(0);
    expect(body.analysis.lines[0].pvSan.length).toBeGreaterThan(0);
    expect(typeof body.analysis.bestMove).toBe('string');
    expect(body.analysis.features.turn).toBe('white');
    expect(body.analysis.features.boardState).toBe('none');
  }, 15000);

  test('POST /analyze-position with a malformed fen returns 400 problem+json', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/analyze-position',
      payload: { fen: 'not-a-fen' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().status).toBe(400);
  });

  test('POST /analyze-position with a missing fen returns 400 problem+json (schema validation)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/analyze-position',
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  test('POST /analyze-game returns evals for each fen in order', async () => {
    const fens = [START_FEN, AFTER_E4_FEN, AFTER_E4_E5_FEN];

    const response = await app.inject({
      method: 'POST',
      url: '/analyze-game',
      payload: { fens, depth: 6 }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { evals: { ply: number; fen: string }[] };
    expect(body.evals).toHaveLength(3);
    expect(body.evals.map((e) => e.ply)).toEqual([0, 1, 2]);
    expect(body.evals.map((e) => e.fen)).toEqual(fens);
  }, 20000);

  test('POST /analyze-game with an illegal fen returns 400 problem+json', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/analyze-game',
      payload: { fens: [START_FEN, 'garbage'] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe(400);
  }, 15000);

  test('POST /analyze-game with an empty fens array is rejected by the schema', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/analyze-game',
      payload: { fens: [] }
    });

    expect(response.statusCode).toBe(400);
  });
});
