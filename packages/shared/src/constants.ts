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

export const ENGINE_MODES = ['native', 'browser'] as const;
export type EngineMode = (typeof ENGINE_MODES)[number];

/**
 * Search depth every backend analyzes at by default. Lives here, in the one
 * package all three of them depend on, because `position_evaluations` is keyed
 * by `fen` alone: a row written by one backend is served to callers using the
 * other, so a depth that differs per backend silently mixes non-comparable
 * evaluations in a single cache. It previously did — services/engine defaulted
 * to 16 while the browser tunnel client hardcoded 15.
 */
export const ENGINE_DEFAULT_DEPTH = 16;

/**
 * Per-position allowance added to the tunnel timeout for a whole-game batch.
 * A batch is one request covering every position in the game, so timing it
 * like a single-position request is wrong by two orders of magnitude: a real
 * 46-ply game measured ~42s end to end in the browser (~0.9s/position on the
 * full-net WASM build), against a flat 10s budget. Sized well above that
 * average so slower machines and sharper positions still land inside it.
 */
export const ENGINE_TUNNEL_PER_POSITION_MS = 4000;
