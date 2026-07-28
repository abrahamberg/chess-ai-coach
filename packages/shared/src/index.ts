export const MISTAKE_CATEGORIES = [
  'hanging_piece',
  'missed_tactic',
  'allowed_tactic',
  'calculation_error',
  'premature_action',
  'passive_play',
  'pawn_structure',
  'king_safety',
  'piece_activity',
  'endgame_technique',
  'opening_knowledge',
  'no_plan',
  'time_management'
] as const;
export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

export const RATING_BANDS = ['novice', 'improving', 'club', 'advanced'] as const;
export type RatingBand = (typeof RATING_BANDS)[number];

export * from './analysis.js';
export * from './coaching-plan.js';
export * from './credits.js';
export * from './finding.js';
export * from './game.js';
export * from './llm.js';
export * from './session.js';
export * from './user.js';
