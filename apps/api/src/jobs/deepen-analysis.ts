import type { Task } from 'graphile-worker';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { analyzePositionViaEngine } from '../services/engine-client.js';
import { runDeepenAnalysisJob, type DeepenAnalysisJobDependencies } from '../services/deepen-analysis.js';

export interface DeepenAnalysisJobPayload {
  gameId: string;
}

export interface DeepenAnalysisTaskOptions {
  db: Kysely<Database>;
  /** services/engine base URL (architecture §4). */
  engineUrl: string;
}

/** graphile-worker Task wrapper around services/deepen-analysis.ts's pure job
 * logic: resolves the real engine HTTP call, delegates the ply walk/batching
 * to runDeepenAnalysisJob. Enqueued by createAnalyzeGameTask once the fast
 * pipeline reaches 'ready' — see jobs/analyze-game.ts. */
export function createDeepenAnalysisTask(options: DeepenAnalysisTaskOptions): Task {
  return async (payload) => {
    const { gameId } = payload as DeepenAnalysisJobPayload;
    const deps: DeepenAnalysisJobDependencies = {
      analyzePosition: (fen) => analyzePositionViaEngine(options.engineUrl, fen)
    };
    await runDeepenAnalysisJob(options.db, deps, gameId);
  };
}
