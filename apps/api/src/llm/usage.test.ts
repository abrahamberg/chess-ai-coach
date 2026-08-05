import type { LanguageModelUsage } from 'ai';
import { describe, expect, test } from 'vitest';
import { toBillableTokens, toTurnUsage } from './usage.js';

function usage(overrides: {
  noCacheTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}): LanguageModelUsage {
  return {
    inputTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: overrides.noCacheTokens,
      cacheReadTokens: overrides.cacheReadTokens,
      cacheWriteTokens: overrides.cacheWriteTokens
    },
    outputTokens: overrides.outputTokens,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: overrides.reasoningTokens },
    totalTokens: undefined
  };
}

describe('toTurnUsage', () => {
  test('maps the SDK-normalized cache detail straight through — no provider branching', () => {
    expect(
      toTurnUsage(
        usage({ noCacheTokens: 412, cacheReadTokens: 2180, cacheWriteTokens: 0, outputTokens: 186, reasoningTokens: 64 })
      )
    ).toEqual({
      freshInputTokens: 412,
      cacheReadTokens: 2180,
      cacheWriteTokens: 0,
      outputTokens: 186,
      reasoningTokens: 64
    });
  });

  test('an absent cacheWriteTokens stays null, never 0 — a provider with no cache-write concept must not read as "nothing was cached"', () => {
    const result = toTurnUsage(usage({ noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }));
    expect(result.cacheWriteTokens).toBeNull();
  });

  test('a cacheWriteTokens of 0 is preserved as 0, distinct from absent', () => {
    expect(toTurnUsage(usage({ cacheWriteTokens: 0 })).cacheWriteTokens).toBe(0);
  });

  test('missing counts default to 0 rather than undefined, so the DB columns and frontend schema always get a number', () => {
    expect(toTurnUsage(usage({}))).toEqual({
      freshInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: null,
      outputTokens: 0,
      reasoningTokens: 0
    });
  });

  test('a NaN count (seen live from OpenAI on multi-step tool-calling turns) sanitizes to 0, not a JSON-null that would fail the frontend schema', () => {
    const result = toTurnUsage(usage({ noCacheTokens: NaN, outputTokens: NaN, reasoningTokens: NaN }));
    expect(result).toEqual({
      freshInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: null,
      outputTokens: 0,
      reasoningTokens: 0
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('toBillableTokens', () => {
  test('inputTokens is the pre-discount total (fresh + cache-read), which is what computeCredits expects', () => {
    const billable = toBillableTokens(
      toTurnUsage(usage({ noCacheTokens: 400, cacheReadTokens: 2000, cacheWriteTokens: 0, outputTokens: 50 }))
    );
    expect(billable).toEqual({ inputTokens: 2400, outputTokens: 50, cachedInputTokens: 2000 });
  });

  test('cache-write tokens are excluded from the billable total (the cache-write premium is out of scope)', () => {
    const billable = toBillableTokens(
      toTurnUsage(usage({ noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 900, outputTokens: 10 }))
    );
    expect(billable.inputTokens).toBe(100);
  });
});
