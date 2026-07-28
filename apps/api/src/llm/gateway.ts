import type { LlmProvider } from '@chess-coach/shared';
import type { LanguageModel } from 'ai';
import type { Kysely } from 'kysely';
import * as creditsRepo from '../db/repositories/credits.js';
import * as llmKeysRepo from '../db/repositories/llm-keys.js';
import type { Database } from '../db/schema.js';
import { anthropicModel } from './anthropic.js';
import { computeCredits, type UsageTokens } from './metering.js';
import { openaiModel } from './openai.js';
import type { KeyVault } from './key-vault.js';

export type Tier = 'standard' | 'light';

export interface GatewayConfig {
  keyVault: KeyVault;
  /** Platform (non-BYOK) keys. Anthropic is used when both are configured. */
  platformKeys: { anthropic?: string; openai?: string };
  modelIds: Record<Tier, Record<LlmProvider, string>>;
  /** architecture §8: standard=1, light=0.25 by default (CREDIT_MULT_STANDARD/_LIGHT). */
  tierMultipliers?: Record<Tier, number>;
}

export interface ModelResolution {
  model: LanguageModel;
  metered: boolean;
  provider: LlmProvider;
  modelId: string;
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
  const byok = await resolveByokKey(db, config.keyVault, userId);
  if (byok) {
    const modelId = config.modelIds[tier][byok.provider];
    return {
      model: buildModel(byok.provider, byok.apiKey, modelId),
      metered: false,
      provider: byok.provider,
      modelId
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
    modelId
  };
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
export async function recordUsage(
  db: Kysely<Database>,
  args: RecordUsageArgs,
  tierMultipliers: Record<Tier, number> = DEFAULT_TIER_MULTIPLIERS
): Promise<void> {
  const credits = args.metered ? computeCredits(args.usage, tierMultipliers[args.tier]) : 0;

  await db.transaction().execute(async (trx) => {
    if (args.metered && credits > 0) {
      await creditsRepo.insertUsageDebit(trx, args.userId, args.sessionId ?? null, credits);
    }
    await creditsRepo.insertCallLog(trx, {
      userId: args.userId,
      sessionId: args.sessionId ?? null,
      provider: args.provider,
      model: args.model,
      inputTokens: args.usage.inputTokens,
      outputTokens: args.usage.outputTokens,
      cachedInputTokens: args.usage.cachedInputTokens,
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

function buildModel(provider: LlmProvider, apiKey: string, modelId: string): LanguageModel {
  return provider === 'anthropic' ? anthropicModel(apiKey, modelId) : openaiModel(apiKey, modelId);
}
