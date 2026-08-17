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
 * Per-position allowance added to the tunnel timeout, for both a single
 * analyzePosition request and each position folded into a whole-game
 * analyzeGame batch. This isn't an average — it has to cover the *worst*
 * position, because `go depth 16` / multiPv 3 has no time bound at all: the
 * single-threaded full-net WASM build measured 9.9s-16.1s on ordinary early
 * Ruy Lopez positions (wide-open, nothing to prune, three full lines to
 * maintain), against sharper middlegame positions finishing in ~3-4s. Every
 * new game's first chunk is the opening, so an average-sized budget fails
 * almost every browser-mode import at the very first chunk. Product call:
 * browser-mode analysis is allowed to take minutes — correctness and
 * depth-16 parity with the native engine matter more than latency here.
 */
export const ENGINE_TUNNEL_PER_POSITION_MS = 30_000;
