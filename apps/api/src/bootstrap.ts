import { generateText } from 'ai';
import type { EngineEval } from '@chess-coach/shared';
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
 * jobs/analyze-game.ts's callPlannerModel, but coach-tools' engine-interpreter
 * call isn't attributed to a specific user's BYOK — see coach-agent.ts). */
export function buildCoachAgentDependencies(
  db: Kysely<Database>,
  jobQueue: JobQueue,
  gatewayConfig: GatewayConfig,
  engineUrl: string
): CoachAgentDependencies {
  const lightModel = buildLightModel(gatewayConfig);

  return {
    db,
    jobQueue,
    gatewayConfig,
    analyzePosition: (fen) => analyzePositionViaEngine(engineUrl, fen),
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

async function analyzePositionViaEngine(engineUrl: string, fen: string): Promise<EngineEval> {
  const response = await fetch(`${engineUrl}/analyze-position`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fen, multiPv: COACH_ENGINE_MULTI_PV })
  });
  if (!response.ok) throw new Error(`engine analyze-position failed: HTTP ${response.status}`);
  const body = (await response.json()) as { eval: EngineEval };
  return body.eval;
}
