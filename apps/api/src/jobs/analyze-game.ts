import { CoachingPlanSchema, type CoachingPlan } from '@chess-coach/shared';
import type { Task } from 'graphile-worker';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import type { Database } from '../db/schema.js';
import { getModelForUser, recordUsage, type GatewayConfig } from '../llm/gateway.js';
import { generateStructured } from '../llm/text.js';
import { toBillableTokens } from '../llm/usage.js';
import { analyzeGameViaEngine } from '../services/engine-client.js';
import { runAnalyzeGameJob, type AnalysisJobDependencies, type PlannerMessages } from '../services/analysis.js';
import type { DeepenAnalysisJobPayload } from './deepen-analysis.js';

export interface AnalyzeGameJobPayload {
  gameId: string;
}

export interface AnalyzeGameTaskOptions {
  db: Kysely<Database>;
  /** services/engine base URL (architecture §4). */
  engineUrl: string;
  gatewayConfig: GatewayConfig;
}

/** graphile-worker Task wrapper around services/analysis.ts's pure job logic:
 * resolves the real engine HTTP call and the real light-tier planner call, then
 * delegates the actual pipeline (and its retry/error handling) to runAnalyzeGameJob.
 * Once that pipeline reaches 'ready', enqueues the deepen-analysis follow-up
 * pass (jobs/deepen-analysis.ts) via graphile-worker's own job-helpers addJob
 * rather than a failed/'ready' check inside runAnalyzeGameJob itself, so the
 * fast pipeline's own error handling stays untouched. */
export function createAnalyzeGameTask(options: AnalyzeGameTaskOptions): Task {
  return async (payload, helpers) => {
    const { gameId } = payload as AnalyzeGameJobPayload;
    const game = await gamesRepo.findById(options.db, gameId);
    if (!game) throw new Error(`Game ${gameId} not found`);

    const deps: AnalysisJobDependencies = {
      analyzeGamePositions: (fens) => analyzeGameViaEngine(options.engineUrl, fens),
      callPlanner: (messages) => callPlannerModel(options.db, options.gatewayConfig, game.userId, messages)
    };

    await runAnalyzeGameJob(options.db, deps, gameId);

    const analysis = await analysesRepo.findByGameId(options.db, gameId);
    if (analysis?.status === 'ready') {
      await helpers.addJob('deepen-analysis', { gameId } satisfies DeepenAnalysisJobPayload);
    }
  };
}

async function callPlannerModel(
  db: Kysely<Database>,
  gatewayConfig: GatewayConfig,
  userId: string,
  messages: PlannerMessages
): Promise<CoachingPlan> {
  const resolution = await getModelForUser(db, gatewayConfig, userId, 'light');
  const result = await generateStructured({
    resolution,
    system: messages.system,
    prompt: messages.user,
    schema: CoachingPlanSchema
  });

  await recordUsage(db, {
    userId,
    provider: resolution.provider,
    model: resolution.modelId,
    tier: 'light',
    usage: toBillableTokens(result.usage),
    purpose: 'analysis_plan',
    metered: resolution.metered
  });

  return result.object;
}
