import { describe, expect, test } from 'vitest';
import { computeCredits } from './metering.js';

describe('computeCredits', () => {
  test('standard tier (1x): 3000 billable tokens -> 3 credits', () => {
    const credits = computeCredits(
      { inputTokens: 2500, outputTokens: 500, cachedInputTokens: 0 },
      1
    );
    expect(credits).toBe(3);
  });

  test('light tier (0.25x): rounds up rather than down to zero', () => {
    const credits = computeCredits(
      { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 0 },
      0.25
    );
    expect(credits).toBe(1);
  });

  test('cached input tokens are billed at 1/4 rate', () => {
    // billable = 1000 - 800 + 800/4 + 0 = 400 -> 0.4k -> *1 -> ceil -> 1
    const credits = computeCredits(
      { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 800 },
      1
    );
    expect(credits).toBe(1);
  });

  test('zero usage costs zero credits', () => {
    const credits = computeCredits(
      { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      1
    );
    expect(credits).toBe(0);
  });

  test('always returns an integer, never a fraction', () => {
    const credits = computeCredits(
      { inputTokens: 100, outputTokens: 0, cachedInputTokens: 0 },
      0.25
    );
    expect(Number.isInteger(credits)).toBe(true);
  });
});
