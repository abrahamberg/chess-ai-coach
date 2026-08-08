import type { EngineEval, PositionAnalysis } from '@chess-coach/shared';
import { analyzePositionViaEngine, analyzeGameViaEngine, ENGINE_MULTI_PV } from '../engine-client.js';
import type { EngineBackend, EngineBackendAnalyzeOptions } from './engine-backend.js';

/**
 * Native engine backend that wraps the existing HTTP engine client.
 * Delegates to analyzePositionViaEngine and analyzeGameViaEngine from engine-client.ts.
 */
export class NativeEngineBackend implements EngineBackend {
  constructor(private engineUrl: string) {}

  async analyzePosition(
    fen: string,
    opts?: EngineBackendAnalyzeOptions
  ): Promise<PositionAnalysis> {
    const multiPv = opts?.multiPv ?? ENGINE_MULTI_PV;
    return analyzePositionViaEngine(this.engineUrl, fen, multiPv);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async analyzeGame(fens: string[], opts?: EngineBackendAnalyzeOptions): Promise<EngineEval[]> {
    // Note: analyzeGameViaEngine doesn't currently support depth/multiPv overrides,
    // but we accept opts for API consistency with future backends.
    // The underlying function uses the engine's defaults.
    return analyzeGameViaEngine(this.engineUrl, fens);
  }
}
