import { describe, expect, test } from 'vitest';
import { RATING_BANDS } from '@chess-coach/shared';
import { CALIBRATION } from './calibration.js';

describe('CALIBRATION', () => {
  test('has an entry for every rating band', () => {
    expect(Object.keys(CALIBRATION).sort()).toEqual([...RATING_BANDS].sort());
  });

  test('matches prompts.md §2.3 revealDepthPlies values', () => {
    expect(CALIBRATION.novice.revealDepthPlies).toBe(2);
    expect(CALIBRATION.improving.revealDepthPlies).toBe(4);
    expect(CALIBRATION.club.revealDepthPlies).toBe(6);
    expect(CALIBRATION.advanced.revealDepthPlies).toBe(10);
  });

  test('descriptions match prompts.md §2.3 verbatim', () => {
    expect(CALIBRATION.novice.description).toBe(
      'Around 500–900 chess.com. Knows the rules and basic tactics by name. Biggest wins come from board vision and a consistent blunder-check. Use plain language, no jargon beyond fork/pin/skewer. Show very short lines (a move or two) and always say the idea in words. Celebrate every good habit.'
    );
    expect(CALIBRATION.advanced.description).toBe(
      'Around 1700–2000 chess.com. Strong club player. Work on decision-making quality: evaluating unforced positions, prophylaxis, converting advantages, and knowing WHEN to calculate deeply vs play positionally. Speak as one strong player to another; full variations are fine.'
    );
  });
});
