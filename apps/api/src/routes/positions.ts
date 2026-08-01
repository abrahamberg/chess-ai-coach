import { AnalyzePositionRequestSchema, type PositionAnalysis } from '@chess-coach/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { ForbiddenError, ValidationError } from '../lib/errors.js';
import * as userProfileService from '../services/user-profile.js';

/**
 * On-demand rich position analysis for the browser (docs/design.md
 * principle 4's opt-in override) — reuses the same `analyzePosition`
 * dependency the coach agent's get_engine_analysis tool calls, gated
 * server-side by the student's own showEngineAnalysis preference so the
 * toggle is a real gate, not just a client-side hide, and so Stockfish
 * calls can't be triggered by students who never opted in.
 */
export function registerPositionAnalysisRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  analyzePosition: (fen: string) => Promise<PositionAnalysis>
): void {
  app.post('/api/positions/analyze', async (request) => {
    const parsed = AnalyzePositionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const user = await userProfileService.getOrCreate(db, request.user);
    if (!user.showEngineAnalysis) {
      throw new ForbiddenError('Engine analysis is not enabled for this account');
    }

    return analyzePosition(parsed.data.fen);
  });
}
