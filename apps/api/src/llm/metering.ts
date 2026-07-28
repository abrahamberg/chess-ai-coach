export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/** architecture §8: cached input is billed at 1/4 rate; the tier multiplier
 * (standard=1, light=0.25 by default, both env-configurable) applies to the
 * whole billable-token total, and the final result is rounded up to an
 * integer credit count — never a fraction, even for the light tier. */
export function computeCredits(usage: UsageTokens, tierMultiplier: number): number {
  const billableTokens =
    usage.inputTokens - usage.cachedInputTokens + usage.cachedInputTokens / 4 + usage.outputTokens;
  return Math.ceil((billableTokens / 1000) * tierMultiplier);
}
