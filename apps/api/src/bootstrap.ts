import { generateText } from 'ai';
import type { PositionAnalysis } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import type { Database } from './db/schema.js';
import type { JobQueue } from './jobs/queue.js';
import { buildModel, type GatewayConfig } from './llm/gateway.js';
import { buildFakeModel } from './llm/fake.js';
import type { KeyVault } from './llm/key-vault.js';
import type { CoachAgentDependencies } from './services/coach-agent.js';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** Reads the env vars architecture §8 defines for the LLM gateway. Platform
 * keys are optional (a deployment can run BYOK-only), model ids are required.
 * `LLM_FAKE=1` (Task 7.2 smoke-test mode) short-circuits every model call in
 * getModelForUser — see llm/gateway.ts. */
export function buildGatewayConfigFromEnv(keyVault: KeyVault): GatewayConfig {
  return {
    keyVault,
    platformKeys: {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY
    },
    modelIds: {
      standard: {
        anthropic: requireEnv('LLM_STANDARD_MODEL_ANTHROPIC'),
        openai: requireEnv('LLM_STANDARD_MODEL_OPENAI')
      },
      light: {
        anthropic: requireEnv('LLM_LIGHT_MODEL_ANTHROPIC'),
        openai: requireEnv('LLM_LIGHT_MODEL_OPENAI')
      }
    },
    fake: process.env.LLM_FAKE === '1'
  };
}

/** Wires the real (non-test) CoachAgentDependencies: engine HTTP client for
 * analyzePosition, a platform-key light model for callLightModel (mirrors
 * jobs/analyze-game.ts's callPlannerModel, but coach-context's episode-fold
 * calls aren't attributed to a specific user's BYOK — see coach-agent.ts). */
export function buildCoachAgentDependencies(
  db: Kysely<Database>,
  jobQueue: JobQueue,
  gatewayConfig: GatewayConfig,
  engineUrl: string
): CoachAgentDependencies {
  const lightModel = buildLightModel(gatewayConfig);
  const fenAnalysisCache = new Map<string, PositionAnalysis>();

  return {
    db,
    jobQueue,
    gatewayConfig,
    analyzePosition: (fen) => analyzePositionCached(fenAnalysisCache, engineUrl, fen),
    callLightModel: async (messages) => {
      const result = await generateText({ model: lightModel, system: messages.system, prompt: messages.user });
      return result.text;
    }
  };
}

function buildLightModel(gatewayConfig: GatewayConfig) {
  if (gatewayConfig.fake) return buildFakeModel();
  const provider = gatewayConfig.platformKeys.anthropic ? 'anthropic' : 'openai';
  const apiKey = gatewayConfig.platformKeys[provider];
  if (!apiKey) throw new Error('No platform LLM key configured (required for callLightModel)');
  return buildModel(provider, apiKey, gatewayConfig.modelIds.light[provider]);
}

/** Requests 3 principal variations (the engine's default is 2) so the coach
 * can answer "what are the best moves here?" with real candidates instead of
 * just judging the one move the student proposed. */
const COACH_ENGINE_MULTI_PV = 3;

/** A position's analysis is a pure function of its FEN at this fixed depth/
 * multiPv, so caching by exact FEN is safe. Bounded process-wide cache
 * (one per buildCoachAgentDependencies call, i.e. per process — this is
 * called once at server startup): both the auto-injected "## Current
 * position" block (coach-context.ts) and the get_engine_analysis tool call
 * into the same fen, often for the same position across several turns of
 * one episode — without this every turn re-runs a fresh Stockfish search. */
const FEN_ANALYSIS_CACHE_MAX = 200;

async function analyzePositionCached(
  cache: Map<string, PositionAnalysis>,
  engineUrl: string,
  fen: string
): Promise<PositionAnalysis> {
  const cached = cache.get(fen);
  if (cached) return cached;

  const analysis = await analyzePositionViaEngine(engineUrl, fen);
  if (cache.size >= FEN_ANALYSIS_CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(fen, analysis);
  return analysis;
}

async function analyzePositionViaEngine(engineUrl: string, fen: string): Promise<PositionAnalysis> {
  const response = await fetch(`${engineUrl}/analyze-position`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fen, multiPv: COACH_ENGINE_MULTI_PV })
  });
  if (!response.ok) throw new Error(`engine analyze-position failed: HTTP ${response.status}`);
  const body = (await response.json()) as { analysis: PositionAnalysis };
  return body.analysis;
}
