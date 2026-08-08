import type { Task } from 'graphile-worker';
import type { Kysely } from 'kysely';
import * as gamesRepo from '../db/repositories/games.js';
import type { Database } from '../db/schema.js';
import { resolveEngineBackend, type ResolveEngineBackendOptions } from '../services/engine/resolve-engine-backend.js';
import { runDeepenAnalysisJob, type DeepenAnalysisJobDependencies } from '../services/deepen-analysis.js';

export interface DeepenAnalysisJobPayload {
  gameId: string;
}

export interface DeepenAnalysisTaskOptions {
  db: Kysely<Database>;
  engineBackendOptions: ResolveEngineBackendOptions;
}

/** graphile-worker Task wrapper around services/deepen-analysis.ts's pure job
 * logic: resolves the real engine HTTP call, delegates the ply walk/batching
 * to runDeepenAnalysisJob. Enqueued by createAnalyzeGameTask once the fast
 * pipeline reaches 'ready' — see jobs/analyze-game.ts. */
export function createDeepenAnalysisTask(options: DeepenAnalysisTaskOptions): Task {
  return async (payload) => {
    const { gameId } = payload as DeepenAnalysisJobPayload;
    const game = await gamesRepo.findById(options.db, gameId);
    if (!game) throw new Error(`Game ${gameId} not found`);

    const backend = await resolveEngineBackend(options.engineBackendOptions, game.userId);
    const deps: DeepenAnalysisJobDependencies = {
      analyzePosition: (fen) => backend.analyzePosition(fen)
    };
    await runDeepenAnalysisJob(options.db, deps, gameId);
  };
}
