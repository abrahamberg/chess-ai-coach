import { expect, test } from 'vitest';
import { MISTAKE_CATEGORIES, RATING_BANDS } from './index.js';

test('mistake taxonomy has the 13 agreed categories', () => {
  expect(MISTAKE_CATEGORIES).toHaveLength(13);
  expect(new Set(MISTAKE_CATEGORIES).size).toBe(13);
});

test('rating bands are the 4 agreed bands in order', () => {
  expect(RATING_BANDS).toEqual(['novice', 'improving', 'club', 'advanced']);
});
