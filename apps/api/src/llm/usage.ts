import type { LanguageModelUsage } from 'ai';
import type { UsageTokens } from './metering.js';

/** Provider-normalized token usage for one model call (coach debug mode
 * design doc, "Provider-specific usage"). `cacheWriteTokens` is `null` —
 * never `0` — when the provider has no cache-write concept at all (OpenAI's
 * prefix caching is automatic and free to populate), so the debug panel can
 * tell "no such thing" apart from "nothing was written". */
export interface TurnUsage {
  freshInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number | null;
  outputTokens: number;
  /** Non-zero only while `reasoning` is enabled for the tier — these tokens
   * are billed as output but never appear in the response text. */
  reasoningTokens: number;
}

/** Providers occasionally report non-finite usage on multi-step tool-calling
 * turns (the same quirk `gateway.ts`'s `toSafeCount` guards for the DB
 * columns) — a NaN here would serialize to `null` over JSON and fail the
 * frontend's schema validation, so every number is sanitized at this
 * boundary too. */
function toSafeCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The AI SDK reports cache reads/writes in a single normalized shape across
 * providers, so — unlike the hand-rolled reconciliation this replaces — no
 * provider branching is needed here at all.
 */
export function toTurnUsage(usage: LanguageModelUsage): TurnUsage {
  return {
    freshInputTokens: toSafeCount(usage.inputTokenDetails.noCacheTokens),
    cacheReadTokens: toSafeCount(usage.inputTokenDetails.cacheReadTokens),
    // Deliberately not run through toSafeCount: `null` is meaningful here.
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null,
    outputTokens: toSafeCount(usage.outputTokens),
    reasoningTokens: toSafeCount(usage.outputTokenDetails.reasoningTokens)
  };
}

/** The billing view of a turn: total input tokens (fresh + reused-from-cache),
 * matching `computeCredits`' expectation of a pre-discount input total.
 * Cache-write tokens are intentionally excluded — billing math for the
 * cache-write premium is out of scope (see design doc). */
export function toBillableTokens(usage: TurnUsage): UsageTokens {
  return {
    inputTokens: usage.freshInputTokens + usage.cacheReadTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cacheReadTokens
  };
}
