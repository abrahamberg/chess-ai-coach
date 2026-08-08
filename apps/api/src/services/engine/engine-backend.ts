import type { EngineEval, PositionAnalysis } from '@chess-coach/shared';

/**
 * Options for engine backend analysis methods.
 */
export interface EngineBackendAnalyzeOptions {
  depth?: number;
  multiPv?: number;
}

/**
 * Pluggable interface for engine backends (native HTTP, browser tunnel, caching decorator, etc.).
 * All backends must conform to this interface.
 */
export interface EngineBackend {
  /**
   * Analyze a single chess position.
   *
   * @param fen - The position in FEN notation
   * @param opts - Optional analysis parameters (depth, multiPv)
   * @returns Promise resolving to the analysis of the position
   */
  analyzePosition(fen: string, opts?: EngineBackendAnalyzeOptions): Promise<PositionAnalysis>;

  /**
   * Analyze a game as a batch of positions.
   *
   * @param fens - An array of FEN strings (typically one per ply of the game)
   * @param opts - Optional analysis parameters (depth, multiPv)
   * @returns Promise resolving to an array of engine evaluations
   */
  analyzeGame(fens: string[], opts?: EngineBackendAnalyzeOptions): Promise<EngineEval[]>;
}
