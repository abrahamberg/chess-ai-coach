import type { LlmProvider } from '@chess-coach/shared';
import type { ProviderMetadata } from 'ai';

/** Provider-normalized token usage for a turn (coach debug mode design doc,
 * "Provider-specific usage"). `cacheWriteTokens` is `null` — never `0` — for
 * OpenAI, since it has no cache-write concept at all (its prefix caching is
 * automatic and free to populate). */
export interface TurnUsage {
  freshInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number | null;
  outputTokens: number;
}

/** Providers occasionally report non-finite usage on multi-step tool-calling
 * turns (same quirk `gateway.ts`'s `toSafeCount` guards against for the DB
 * columns) — a NaN here would silently serialize to `null` over JSON and fail
 * the frontend's schema validation, so every number normalizeUsage produces
 * is sanitized at this boundary too. */
function toSafeCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Reconciles Anthropic's and OpenAI's incompatible usage-reporting shapes
 * (design doc, "Provider-specific usage"): Anthropic's `promptTokens` is
 * fresh-only and cache stats live in `providerMetadata.anthropic`; OpenAI's
 * `promptTokens` already includes cached tokens and has no cache-write
 * concept at all (hence `cacheWriteTokens: null`, never coerced to 0).
 */
export function normalizeUsage(
  provider: LlmProvider,
  usage: { promptTokens: number; completionTokens: number },
  providerMetadata: ProviderMetadata | undefined
): TurnUsage {
  const promptTokens = toSafeCount(usage.promptTokens);
  const completionTokens = toSafeCount(usage.completionTokens);

  if (provider === 'anthropic') {
    const anthropic = providerMetadata?.anthropic as
      | { cacheCreationInputTokens?: number | null; cacheReadInputTokens?: number | null }
      | undefined;
    return {
      freshInputTokens: promptTokens,
      cacheReadTokens: toSafeCount(anthropic?.cacheReadInputTokens),
      cacheWriteTokens: toSafeCount(anthropic?.cacheCreationInputTokens),
      outputTokens: completionTokens
    };
  }

  const openai = providerMetadata?.openai as { cachedPromptTokens?: number | null } | undefined;
  const cacheReadTokens = toSafeCount(openai?.cachedPromptTokens);
  return {
    freshInputTokens: promptTokens - cacheReadTokens,
    cacheReadTokens,
    cacheWriteTokens: null,
    outputTokens: completionTokens
  };
}
