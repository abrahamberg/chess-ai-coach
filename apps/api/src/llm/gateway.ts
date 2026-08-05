import type { LlmProvider } from '@chess-coach/shared';
import type { LanguageModel } from 'ai';
import type { Kysely } from 'kysely';
import * as creditsRepo from '../db/repositories/credits.js';
import * as llmKeysRepo from '../db/repositories/llm-keys.js';
import type { Database } from '../db/schema.js';
import { anthropicModel } from './anthropic.js';
import { buildFakeModel } from './fake.js';
import { computeCredits, type UsageTokens } from './metering.js';
import { callOptionsFor, DEFAULT_MODEL_TUNING, type ModelCallOptions, type ModelTuning, type Tier } from './model-options.js';
import { openaiModel } from './openai.js';
import type { KeyVault } from './key-vault.js';

export type { Tier };

export interface GatewayConfig {
  keyVault: KeyVault;
  /** Platform (non-BYOK) keys. Anthropic is used when both are configured. */
  platformKeys: { anthropic?: string; openai?: string };
  modelIds: Record<Tier, Record<LlmProvider, string>>;
  /** How each tier is called (reasoning effort, OpenAI service tier, stream
   * timeouts) — see model-options.ts. Defaults when unset. */
  tuning?: ModelTuning;
  /** architecture §8: standard=1, light=0.25 by default (CREDIT_MULT_STANDARD/_LIGHT). */
  tierMultipliers?: Record<Tier, number>;
  /** Task 7.2: LLM_FAKE=1 local-dev/smoke-test mode — every getModelForUser
   * call returns a canned mock model stream, no keys or DB lookups. */
  fake?: boolean;
}

export interface ModelResolution {
  model: LanguageModel;
  metered: boolean;
  provider: LlmProvider;
  modelId: string;
  /** Spread into the `streamText`/`generateText` call alongside the model. */
  callOptions: ModelCallOptions;
}

const DEFAULT_TIER_MULTIPLIERS: Record<Tier, number> = { standard: 1, light: 0.25 };

/** Resolves the model to use for a user's call: their BYOK key if they have one
 * (Anthropic preferred if both are set), else the platform key with metering. */
export async function getModelForUser(
  db: Kysely<Database>,
  config: GatewayConfig,
  userId: string,
  tier: Tier
): Promise<ModelResolution> {
  if (config.fake) {
    return {
      model: buildFakeModel(),
      metered: false,
      provider: 'anthropic',
      modelId: 'llm-fake',
      callOptions: resolveCallOptions(config, 'anthropic', tier)
    };
  }

  // BYOK users get the same reasoning and provider tuning as platform users —
  // it rides on the resolution, not on the billing path.
  const byok = await resolveByokKey(db, config.keyVault, userId);
  if (byok) {
    const modelId = config.modelIds[tier][byok.provider];
    return {
      model: buildModel(byok.provider, byok.apiKey, modelId),
      metered: false,
      provider: byok.provider,
      modelId,
      callOptions: resolveCallOptions(config, byok.provider, tier)
    };
  }

  const provider = platformProviderFor(config);
  const apiKey = config.platformKeys[provider];
  if (!apiKey) throw new Error('No platform LLM key configured');
  const modelId = config.modelIds[tier][provider];
  return {
    model: buildModel(provider, apiKey, modelId),
    metered: true,
    provider,
    modelId,
    callOptions: resolveCallOptions(config, provider, tier)
  };
}

export function resolveCallOptions(config: GatewayConfig, provider: LlmProvider, tier: Tier): ModelCallOptions {
  return callOptionsFor(config.tuning ?? DEFAULT_MODEL_TUNING, provider, tier);
}

export function streamTimeoutsFor(config: GatewayConfig): ModelTuning['streamTimeouts'] {
  return (config.tuning ?? DEFAULT_MODEL_TUNING).streamTimeouts;
}

export interface RecordUsageArgs {
  userId: string;
  sessionId?: string;
  provider: LlmProvider;
  model: string;
  tier: Tier;
  usage: UsageTokens;
  purpose: string;
  metered: boolean;
}

/** Writes the credit ledger debit (when metered) and the llm_call_log row in one
 * transaction — a call is either fully recorded or not recorded at all. */
/** Providers occasionally report non-finite usage (seen with OpenAI on
 * multi-step tool-calling turns) — every integer DB column downstream of this
 * must never receive NaN/Infinity, so sanitize once at the boundary. */
function toSafeCount(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export async function recordUsage(
  db: Kysely<Database>,
  args: RecordUsageArgs,
  tierMultipliers: Record<Tier, number> = DEFAULT_TIER_MULTIPLIERS
): Promise<void> {
  const usage: UsageTokens = {
    inputTokens: toSafeCount(args.usage.inputTokens),
    outputTokens: toSafeCount(args.usage.outputTokens),
    cachedInputTokens: toSafeCount(args.usage.cachedInputTokens)
  };
  const credits = args.metered ? computeCredits(usage, tierMultipliers[args.tier]) : 0;

  await db.transaction().execute(async (trx) => {
    if (args.metered && credits > 0) {
      await creditsRepo.insertUsageDebit(trx, args.userId, args.sessionId ?? null, credits);
    }
    await creditsRepo.insertCallLog(trx, {
      userId: args.userId,
      sessionId: args.sessionId ?? null,
      provider: args.provider,
      model: args.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      creditsMetered: credits,
      purpose: args.purpose
    });
  });
}

async function resolveByokKey(
  db: Kysely<Database>,
  keyVault: KeyVault,
  userId: string
): Promise<{ provider: LlmProvider; apiKey: string } | null> {
  const keys = await llmKeysRepo.findAllByUser(db, userId);
  const preferred = keys.find((key) => key.provider === 'anthropic') ?? keys[0];
  if (!preferred) return null;
  const apiKey = keyVault.decrypt({ ciphertext: preferred.keyCiphertext, iv: preferred.keyIv });
  return { provider: preferred.provider, apiKey };
}

function platformProviderFor(config: GatewayConfig): LlmProvider {
  return config.platformKeys.anthropic ? 'anthropic' : 'openai';
}

export function buildModel(provider: LlmProvider, apiKey: string, modelId: string): LanguageModel {
  return provider === 'anthropic' ? anthropicModel(apiKey, modelId) : openaiModel(apiKey, modelId);
}
