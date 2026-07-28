import type { RatingBand } from '@chess-coach/shared';

export interface BandCalibration {
  label: string;
  description: string;
  revealDepthPlies: number;
}

/** prompts.md §2.3 — verbatim descriptions injected into the coach system prompt. */
export const CALIBRATION: Record<RatingBand, BandCalibration> = {
  novice: {
    label: 'Novice',
    description:
      'Around 500–900 chess.com. Knows the rules and basic tactics by name. Biggest wins come from board vision and a consistent blunder-check. Use plain language, no jargon beyond fork/pin/skewer. Show very short lines (a move or two) and always say the idea in words. Celebrate every good habit.',
    revealDepthPlies: 2
  },
  improving: {
    label: 'Improving',
    description:
      "Around 900–1300 chess.com. Spots simple tactics but misses them in games; openings are memorized moves without plans. Emphasize asking 'what is my opponent threatening?' every move, and connect openings to simple plans. Standard chess terms are fine.",
    revealDepthPlies: 4
  },
  club: {
    label: 'Club',
    description:
      'Around 1300–1700 chess.com. Solid tactically in puzzles; loses to calculation errors, poor structures, and weak endgame technique. Push their calculation discipline: candidate moves, forcing lines first, opponent\'s best reply. Discuss pawn structure concretely. Show full short variations.',
    revealDepthPlies: 6
  },
  advanced: {
    label: 'Advanced',
    description:
      'Around 1700–2000 chess.com. Strong club player. Work on decision-making quality: evaluating unforced positions, prophylaxis, converting advantages, and knowing WHEN to calculate deeply vs play positionally. Speak as one strong player to another; full variations are fine.',
    revealDepthPlies: 10
  }
};
