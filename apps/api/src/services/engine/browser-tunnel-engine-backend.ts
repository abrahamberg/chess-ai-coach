import { z } from 'zod';
import {
  ENGINE_DEFAULT_DEPTH,
  ENGINE_TUNNEL_PER_POSITION_MS,
  EngineEvalSchema,
  PositionAnalysisSchema,
  type EngineEval,
  type PositionAnalysis
} from '@chess-coach/shared';
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
      // depth is always sent, never left undefined: the browser client has to
      // fall back to a constant of its own when it isn't, which is how it ended
      // up searching a ply shallower than the native backend.
      { kind: 'analyze-position', fen, depth: opts?.depth ?? ENGINE_DEFAULT_DEPTH, multiPv: opts?.multiPv ?? ENGINE_MULTI_PV },
      // Same reasoning as analyzeGame below: a single position can be one of
      // the slow ones (see ENGINE_TUNNEL_PER_POSITION_MS's doc), so this needs
      // the same per-position allowance on top of the base, not the base alone.
      this.timeoutMs + ENGINE_TUNNEL_PER_POSITION_MS
    );
    return PositionAnalysisSchema.parse(raw);
  }

  async analyzeGame(fens: string[], opts?: EngineBackendAnalyzeOptions): Promise<EngineEval[]> {
    const raw = await this.transport.request(
      this.userId,
      { kind: 'analyze-game', fens, depth: opts?.depth ?? ENGINE_DEFAULT_DEPTH, multiPv: opts?.multiPv ?? ENGINE_MULTI_PV },
      // Scaled by batch size — this one request covers every position in the
      // game, so `timeoutMs` (budgeted for a single position) would abort a
      // perfectly healthy analysis a few plies in.
      this.timeoutMs + fens.length * ENGINE_TUNNEL_PER_POSITION_MS
    );
    return EngineEvalArraySchema.parse(raw);
  }
}
