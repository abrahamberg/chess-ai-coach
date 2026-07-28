import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'tokens.css');
const css = readFileSync(cssPath, 'utf8');

const TOKENS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--text',
  '--text-muted',
  '--accent',
  '--accent-contrast',
  '--warn',
  '--board-light',
  '--board-dark',
  '--annotate-1',
  '--annotate-2'
];

describe('tokens.css (design.md §2.1)', () => {
  test('defines every token at least twice (light default + dark override)', () => {
    for (const token of TOKENS) {
      const occurrences = css.split(`${token}:`).length - 1;
      expect(occurrences, `${token} should be defined for both themes`).toBeGreaterThanOrEqual(2);
    }
  });

  test('follows prefers-color-scheme for the dark theme', () => {
    expect(css).toContain('prefers-color-scheme: dark');
  });

  test('supports a manual theme override (data-theme attribute)', () => {
    expect(css).toContain("data-theme='dark'");
    expect(css).toContain("data-theme='light'");
  });

  test('light and dark --bg values differ (sanity check the theming is real)', () => {
    expect(css).toContain('#faf9f7');
    expect(css).toContain('#15140f');
  });

  test('--annotate-1 and --annotate-2 are identical across themes ("same" per design.md)', () => {
    expect(css).toContain('#c9762a');
    expect(css).toContain('#4a7fb5');
  });
});
