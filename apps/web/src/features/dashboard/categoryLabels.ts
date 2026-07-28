import type { MistakeCategory } from '@chess-coach/shared';

/** design.md §4.3/§4.4: "category name in plain words" — never the raw enum. */
export const CATEGORY_LABELS: Record<MistakeCategory, string> = {
  hanging_piece: 'Hanging pieces',
  missed_tactic: 'Missed tactics',
  allowed_tactic: 'Allowed tactics',
  calculation_error: 'Calculation depth',
  premature_action: 'Premature action',
  passive_play: 'Passive play',
  pawn_structure: 'Pawn structure',
  king_safety: 'King safety',
  piece_activity: 'Piece activity',
  endgame_technique: 'Endgame technique',
  opening_knowledge: 'Opening knowledge',
  no_plan: 'Having a plan',
  time_management: 'Time management'
};
