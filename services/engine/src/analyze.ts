import { validateFen } from 'chess.js';
import { computePositionFeatures } from '@chess-coach/chess-analysis';
import type { EngineEval, PositionAnalysis } from '@chess-coach/shared';
import type { EnginePool } from './engine-pool.js';
import { DEFAULT_DEPTH, pvUciToSan, type AnalyzeOptions } from './uci.js';

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

/**
 * Interactive single-position analysis (the on-demand `/analyze-position`
 * path only — analyzeGame/the batch pipeline below is untouched and stays
 * on the lean EngineEval shape). Combines the engine's own lines (each with
 * its full principal variation, not just the first move) with
 * computePositionFeatures' pure, engine-independent static board analysis
 * (hanging pieces, pawn structure, mobility, etc.).
 */
export async function analyzePositionDetailed(
  pool: EnginePool,
  fen: string,
  options: AnalyzeOptions = {}
): Promise<PositionAnalysis> {
  assertValidFen(fen);
  const depth = options.depth ?? DEFAULT_DEPTH;
  const detailedLines = await pool.withEngine((engine) => engine.analyzeDetailed(fen, options));
  const lines = detailedLines.map((line) => ({
    moveUci: line.moveUci,
    moveSan: line.moveSan,
    pvSan: pvUciToSan(fen, line.pvUci),
    cp: line.cp,
    mateIn: line.mateIn
  }));
  const best = lines[0];

  return {
    fen,
    depth,
    multiPv: lines.length,
    bestMove: best?.moveSan ?? null,
    eval: { cp: best?.cp ?? null, mateIn: best?.mateIn ?? null },
    lines,
    features: computePositionFeatures(fen)
  };
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
