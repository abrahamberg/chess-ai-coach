import { AnalyzePositionRequestSchema, type PositionAnalysis } from '@chess-coach/shared';
import type { FastifyInstance } from 'fastify';
import { ValidationError } from '../lib/errors.js';

/**
 * On-demand rich position analysis for the browser — reuses the same
 * `analyzePosition` dependency the coach agent's get_engine_analysis tool
 * calls (cache-first against position_evaluations, live Stockfish on a
 * miss). Available to any authenticated user regardless of their
 * showEngineAnalysis preference: that setting only gates whether the coach
 * volunteers raw engine numbers in chat (docs/design.md principle 4), it's
 * not a gate on this route, which backs the separate move-analysis
 * inspector modal a student opens explicitly.
 */
export function registerPositionAnalysisRoutes(
  app: FastifyInstance,
  analyzePosition: (fen: string) => Promise<PositionAnalysis>
): void {
  app.post('/api/positions/analyze', async (request) => {
    const parsed = AnalyzePositionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    return analyzePosition(parsed.data.fen);
  });
}
