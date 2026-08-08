import { AnalyzePositionRequestSchema } from '@chess-coach/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { ValidationError } from '../lib/errors.js';
import { resolveEngineBackend, type ResolveEngineBackendOptions } from '../services/engine/resolve-engine-backend.js';
import * as userProfileService from '../services/user-profile.js';

/**
 * On-demand rich position analysis for the browser — resolves the requesting
 * user's own EngineBackend (native or browser-tunnel, per their engineMode),
 * wrapped in the same CachingEngineBackend the coach agent's
 * get_engine_analysis tool goes through (cache-first against
 * position_evaluations, live Stockfish on a miss). Available to any
 * authenticated user — backs the separate move-analysis inspector modal a
 * student opens explicitly.
 */
export function registerPositionAnalysisRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  engineBackendOptions: ResolveEngineBackendOptions
): void {
  app.post('/api/positions/analyze', async (request) => {
    const parsed = AnalyzePositionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const user = await userProfileService.getOrCreate(db, request.user);
    const backend = await resolveEngineBackend(engineBackendOptions, user.id);
    return backend.analyzePosition(parsed.data.fen);
  });
}
