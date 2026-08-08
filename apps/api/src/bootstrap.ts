import { OpenAiServiceTierSchema, ReasoningEffortSchema } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import type { Database } from './db/schema.js';
import type { JobQueue } from './jobs/queue.js';
import { buildModel, resolveCallOptions, type GatewayConfig, type ModelResolution } from './llm/gateway.js';
import { buildFakeModel } from './llm/fake.js';
import { DEFAULT_MODEL_TUNING, type ModelTuning } from './llm/model-options.js';
import { generateProse } from './llm/text.js';
import type { KeyVault } from './llm/key-vault.js';
import type { CoachAgentDependencies } from './services/coach-agent.js';
import { getOrComputePositionAnalysis } from './services/position-analysis-cache.js';
import { createStripeClient, type StripeClient } from './services/stripe.js';
import type { EngineTunnelTransport } from './services/engine/engine-tunnel-transport.js';
import type { ResolveEngineBackendOptions } from './services/engine/resolve-engine-backend.js';

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
    tuning: buildModelTuningFromEnv(),
    fake: process.env.LLM_FAKE === '1'
  };
}

/** How each tier is called. All optional with working defaults — a deployment
 * that sets none of these gets `medium` reasoning on the coach, none on light
 * subagents, and OpenAI's normal service tier. Bad values fail here at boot
 * rather than as an opaque 400 from the provider on the first real turn. */
export function buildModelTuningFromEnv(): ModelTuning {
  return {
    reasoning: {
      standard: parseEnum(ReasoningEffortSchema, 'LLM_REASONING_STANDARD', DEFAULT_MODEL_TUNING.reasoning.standard),
      light: parseEnum(ReasoningEffortSchema, 'LLM_REASONING_LIGHT', DEFAULT_MODEL_TUNING.reasoning.light)
    },
    // `flex` is roughly half price but slower and can be refused under load —
    // off by default, flipped on per-deployment.
    openaiServiceTier: parseEnum(
      OpenAiServiceTierSchema,
      'LLM_OPENAI_SERVICE_TIER',
      DEFAULT_MODEL_TUNING.openaiServiceTier
    ),
    streamTimeouts: {
      firstChunkMs: parsePositiveInt('LLM_STREAM_FIRST_CHUNK_TIMEOUT_MS', DEFAULT_MODEL_TUNING.streamTimeouts.firstChunkMs),
      chunkMs: parsePositiveInt('LLM_STREAM_CHUNK_TIMEOUT_MS', DEFAULT_MODEL_TUNING.streamTimeouts.chunkMs)
    }
  };
}

function parseEnum<T extends string>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, name: string, fallback: T): T {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed.data;
}

export function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
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
  const lightResolution = buildLightResolution(gatewayConfig);

  return {
    db,
    jobQueue,
    gatewayConfig,
    analyzePosition: (fen) => getOrComputePositionAnalysis(db, engineUrl, fen),
    callLightModel: async (messages) => {
      const result = await generateProse({
        resolution: lightResolution,
        system: messages.system,
        prompt: messages.user
      });
      return result.text;
    }
  };
}

/** Optional: only wired when STRIPE_SECRET_KEY is set (Task 8.1), the same way
 * platform LLM keys are optional — local/dev docker-compose runs fine with no
 * Stripe configured at all, and /api/credits/checkout + /api/stripe/webhook
 * simply don't register (see app.ts). Once secretKey is set, the rest of the
 * STRIPE_* vars are required together. */
export function buildStripeClientFromEnv(): StripeClient | undefined {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return undefined;

  return createStripeClient({
    secretKey,
    webhookSecret: requireEnv('STRIPE_WEBHOOK_SECRET'),
    priceIds: {
      small: requireEnv('STRIPE_PRICE_SMALL'),
      medium: requireEnv('STRIPE_PRICE_MEDIUM'),
      large: requireEnv('STRIPE_PRICE_LARGE')
    },
    successUrl: requireEnv('STRIPE_CHECKOUT_SUCCESS_URL'),
    cancelUrl: requireEnv('STRIPE_CHECKOUT_CANCEL_URL')
  });
}

/** Reads ENGINE_TUNNEL_TIMEOUT_MS (design spec §2 self-review fix — every
 * other numeric config value here is env-configurable, this one was missing
 * one). Default matches native's rough per-position ceiling. */
export function buildResolveEngineBackendOptions(
  db: Kysely<Database>,
  engineUrl: string,
  tunnelTransport: EngineTunnelTransport
): ResolveEngineBackendOptions {
  return {
    db,
    engineUrl,
    tunnelTransport,
    tunnelTimeoutMs: parsePositiveInt('ENGINE_TUNNEL_TIMEOUT_MS', 10000)
  };
}

/** The light model as a ModelResolution, so it carries the same reasoning and
 * provider tuning as a gateway-resolved one. `metered: false` because these
 * digests are not attributed to a specific user's BYOK — see the doc comment
 * on buildCoachAgentDependencies. */
function buildLightResolution(gatewayConfig: GatewayConfig): ModelResolution {
  if (gatewayConfig.fake) {
    return {
      model: buildFakeModel(),
      metered: false,
      provider: 'anthropic',
      modelId: 'llm-fake',
      callOptions: resolveCallOptions(gatewayConfig, 'anthropic', 'light')
    };
  }
  const provider = gatewayConfig.platformKeys.anthropic ? 'anthropic' : 'openai';
  const apiKey = gatewayConfig.platformKeys[provider];
  if (!apiKey) throw new Error('No platform LLM key configured (required for callLightModel)');
  const modelId = gatewayConfig.modelIds.light[provider];
  return {
    model: buildModel(provider, apiKey, modelId),
    metered: false,
    provider,
    modelId,
    callOptions: resolveCallOptions(gatewayConfig, provider, 'light')
  };
}

