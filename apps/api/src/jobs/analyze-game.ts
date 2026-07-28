import { generateText } from 'ai';
import type { Task } from 'graphile-worker';
import type { Kysely } from 'kysely';
import type { EngineEval } from '@chess-coach/shared';
import * as gamesRepo from '../db/repositories/games.js';
import type { Database } from '../db/schema.js';
import { getModelForUser, recordUsage, type GatewayConfig } from '../llm/gateway.js';
import { runAnalyzeGameJob, type AnalysisJobDependencies, type PlannerMessages } from '../services/analysis.js';

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
 * delegates the actual pipeline (and its retry/error handling) to runAnalyzeGameJob. */
export function createAnalyzeGameTask(options: AnalyzeGameTaskOptions): Task {
  return async (payload) => {
    const { gameId } = payload as AnalyzeGameJobPayload;
    const game = await gamesRepo.findById(options.db, gameId);
    if (!game) throw new Error(`Game ${gameId} not found`);

    const deps: AnalysisJobDependencies = {
      analyzeGamePositions: (fens) => analyzeGameViaEngine(options.engineUrl, fens),
      callPlanner: (messages) => callPlannerModel(options.db, options.gatewayConfig, game.userId, messages)
    };

    await runAnalyzeGameJob(options.db, deps, gameId);
  };
}

async function analyzeGameViaEngine(engineUrl: string, fens: string[]): Promise<EngineEval[]> {
  const response = await fetch(`${engineUrl}/analyze-game`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fens })
  });
  if (!response.ok) throw new Error(`engine analyze-game failed: HTTP ${response.status}`);
  const body = (await response.json()) as { evals: EngineEval[] };
  return body.evals;
}

async function callPlannerModel(
  db: Kysely<Database>,
  gatewayConfig: GatewayConfig,
  userId: string,
  messages: PlannerMessages
): Promise<string> {
  const resolution = await getModelForUser(db, gatewayConfig, userId, 'light');
  const result = await generateText({ model: resolution.model, system: messages.system, prompt: messages.user });

  await recordUsage(db, {
    userId,
    provider: resolution.provider,
    model: resolution.modelId,
    tier: 'light',
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      cachedInputTokens: 0
    },
    purpose: 'analysis_plan',
    metered: resolution.metered
  });

  return result.text;
}
