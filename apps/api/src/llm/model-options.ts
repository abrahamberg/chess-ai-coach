import type { LlmProvider, OpenAiServiceTier, ReasoningEffort } from '@chess-coach/shared';
import type { JSONValue } from 'ai';

/** architecture §8: `standard` is the coach agent itself, `light` every
 * mechanical subagent (planner, summarizer, episode-fold digests). */
export type Tier = 'standard' | 'light';

/** Guards against a provider that accepts a stream and then stalls. Without
 * them the coach's per-session turn lock is held forever and every later
 * message in that session blocks behind it. */
export interface StreamTimeouts {
  /** Time to wait for the first content chunk of a step. Generous, because
   * reasoning models legitimately think for a while before emitting. */
  firstChunkMs: number;
  /** Time to wait between content chunks once a step is producing. */
  chunkMs: number;
}

/** Per-deployment model tuning, read from env in bootstrap.ts. Kept separate
 * from keys/model-ids so the "how do we call it" knobs live in one place. */
export interface ModelTuning {
  reasoning: Record<Tier, ReasoningEffort>;
  openaiServiceTier: OpenAiServiceTier;
  streamTimeouts: StreamTimeouts;
}

/** The call-shaping half of a resolved model: everything that goes into
 * `streamText`/`generateText` alongside the model itself. */
export interface ModelCallOptions {
  reasoning: ReasoningEffort;
  providerOptions?: Record<string, Record<string, JSONValue>>;
}

export const DEFAULT_MODEL_TUNING: ModelTuning = {
  // The coach reasons about chess positions and its own Socratic strategy, so
  // it earns real thinking budget; light-tier subagents only reformat text
  // that has already been decided and would just burn tokens.
  reasoning: { standard: 'medium', light: 'none' },
  openaiServiceTier: 'auto',
  streamTimeouts: { firstChunkMs: 120_000, chunkMs: 60_000 }
};

/**
 * Builds the per-call options for a (provider, tier) pair. This is the ONLY
 * place reasoning and OpenAI's service tier are decided.
 *
 * Reasoning is deliberately expressed through the SDK's portable `reasoning`
 * setting rather than `providerOptions`: it is the one knob both Anthropic
 * and OpenAI understand. Critically, `providerOptions` must NOT carry
 * reasoning keys (`openai.reasoningEffort`, `anthropic.thinking`) — the SDK
 * gives those FULL precedence and silently ignores `reasoning` when either is
 * present, so setting both would quietly disable this setting.
 */
export function callOptionsFor(tuning: ModelTuning, provider: LlmProvider, tier: Tier): ModelCallOptions {
  return {
    reasoning: tuning.reasoning[tier],
    providerOptions: providerOptionsFor(tuning, provider)
  };
}

function providerOptionsFor(
  tuning: ModelTuning,
  provider: LlmProvider
): Record<string, Record<string, JSONValue>> | undefined {
  if (provider !== 'openai') return undefined;
  return {
    openai: {
      serviceTier: tuning.openaiServiceTier,
      // Without this OpenAI emits nothing for its thinking at all, and the
      // coach's thinking note stays permanently empty. `detailed` is the
      // closest OpenAI gets to raw reasoning — the Responses API never
      // exposes the actual reasoning tokens, only a summary of them, so
      // unlike Anthropic (which streams real thinking blocks) this is a hard
      // provider limit rather than a setting. Safe alongside the portable
      // `reasoning` setting: only `reasoningEffort` would override it.
      reasoningSummary: 'detailed'
    }
  };
}
