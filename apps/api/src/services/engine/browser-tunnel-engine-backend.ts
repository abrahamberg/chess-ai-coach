import { z } from 'zod';
import { EngineEvalSchema, PositionAnalysisSchema, type EngineEval, type PositionAnalysis } from '@chess-coach/shared';
import { ENGINE_MULTI_PV } from '../engine-client.js';
import type { EngineBackend, EngineBackendAnalyzeOptions } from './engine-backend.js';
import type { EngineTunnelTransport } from './engine-tunnel-transport.js';

const EngineEvalArraySchema = z.array(EngineEvalSchema);

/**
 * Looks up the caller's live tunnel connection via the injected transport
 * and awaits a correlated response — no fallback, ever (design spec §2/§3).
 * Validates the browser's response with the same zod schemas apps/api
 * trusts everywhere else before returning it, since this is untrusted
 * client-supplied data about to be persisted as authoritative.
 */
export class BrowserTunnelEngineBackend implements EngineBackend {
  constructor(
    private readonly transport: EngineTunnelTransport,
    private readonly userId: string,
    private readonly timeoutMs: number
  ) {}

  async analyzePosition(fen: string, opts?: EngineBackendAnalyzeOptions): Promise<PositionAnalysis> {
    const raw = await this.transport.request(
      this.userId,
      { kind: 'analyze-position', fen, depth: opts?.depth, multiPv: opts?.multiPv ?? ENGINE_MULTI_PV },
      this.timeoutMs
    );
    return PositionAnalysisSchema.parse(raw);
  }

  async analyzeGame(fens: string[], opts?: EngineBackendAnalyzeOptions): Promise<EngineEval[]> {
    const raw = await this.transport.request(
      this.userId,
      { kind: 'analyze-game', fens, depth: opts?.depth, multiPv: opts?.multiPv ?? ENGINE_MULTI_PV },
      this.timeoutMs
    );
    return EngineEvalArraySchema.parse(raw);
  }
}
