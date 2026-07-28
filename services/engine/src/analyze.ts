import { validateFen } from 'chess.js';
import type { EngineEval } from '@chess-coach/shared';
import type { EnginePool } from './engine-pool.js';
import { DEFAULT_DEPTH, type AnalyzeOptions } from './uci.js';

export class InvalidFenError extends Error {
  constructor(readonly fen: string) {
    super(`invalid FEN: ${fen}`);
  }
}

export async function analyzePosition(
  pool: EnginePool,
  fen: string,
  ply: number,
  options: AnalyzeOptions = {}
): Promise<EngineEval> {
  assertValidFen(fen);
  const lines = await pool.withEngine((engine) => engine.analyze(fen, options));
  return { ply, fen, depth: options.depth ?? DEFAULT_DEPTH, lines };
}

/** Analyzes each position of a game sequentially (architecture §4: "sequential per-position analysis"). */
export async function analyzeGame(
  pool: EnginePool,
  fens: string[],
  options: AnalyzeOptions = {}
): Promise<EngineEval[]> {
  const evals: EngineEval[] = [];
  for (const [ply, fen] of fens.entries()) {
    evals.push(await analyzePosition(pool, fen, ply, options));
  }
  return evals;
}

function assertValidFen(fen: string): void {
  const { ok } = validateFen(fen);
  if (!ok) throw new InvalidFenError(fen);
}
