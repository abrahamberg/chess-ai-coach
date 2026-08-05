import { describe, expect, test } from 'vitest';
import { callOptionsFor, DEFAULT_MODEL_TUNING, type ModelTuning } from './model-options.js';

const TUNING: ModelTuning = {
  reasoning: { standard: 'high', light: 'none' },
  openaiServiceTier: 'flex',
  streamTimeouts: { firstChunkMs: 1000, chunkMs: 500 }
};

describe('callOptionsFor', () => {
  test('reasoning comes from the tier, portably — the same setting for both providers', () => {
    expect(callOptionsFor(TUNING, 'anthropic', 'standard').reasoning).toBe('high');
    expect(callOptionsFor(TUNING, 'openai', 'standard').reasoning).toBe('high');
    expect(callOptionsFor(TUNING, 'anthropic', 'light').reasoning).toBe('none');
    expect(callOptionsFor(TUNING, 'openai', 'light').reasoning).toBe('none');
  });

  test('the OpenAI service tier is passed through as a provider option', () => {
    expect(callOptionsFor(TUNING, 'openai', 'standard').providerOptions).toEqual({
      openai: { serviceTier: 'flex', reasoningSummary: 'detailed' }
    });
  });

  // OpenAI emits nothing for its thinking unless this is set, which would
  // leave the debug popup's reasoning section permanently empty.
  test('OpenAI is asked for its reasoning summary, the most it will expose', () => {
    const options = callOptionsFor(TUNING, 'openai', 'standard').providerOptions;
    expect(options?.openai?.reasoningSummary).toBe('detailed');
  });

  test('Anthropic gets no provider options — it has no service-tier equivalent', () => {
    expect(callOptionsFor(TUNING, 'anthropic', 'standard').providerOptions).toBeUndefined();
  });

  // Regression guard: the SDK gives provider-level reasoning keys FULL
  // precedence over the portable `reasoning` setting. If either of these ever
  // appears here, reasoning silently stops being applied — and nothing else
  // in the system would fail to reveal it.
  test('provider options never carry reasoning keys, which would silently override the portable setting', () => {
    for (const tier of ['standard', 'light'] as const) {
      for (const provider of ['anthropic', 'openai'] as const) {
        const options = callOptionsFor(TUNING, provider, tier);
        const serialized = JSON.stringify(options.providerOptions ?? {});
        expect(serialized).not.toContain('reasoningEffort');
        expect(serialized).not.toContain('thinking');
        expect(serialized).not.toContain('thinkingConfig');
      }
    }
  });

  test('the shipped defaults reason on the coach tier and not on light subagents, with flex off', () => {
    expect(DEFAULT_MODEL_TUNING.reasoning.standard).toBe('medium');
    expect(DEFAULT_MODEL_TUNING.reasoning.light).toBe('none');
    expect(DEFAULT_MODEL_TUNING.openaiServiceTier).toBe('auto');
  });
});
