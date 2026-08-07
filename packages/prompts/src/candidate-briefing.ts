/**
 * Play mode's get_candidate_moves tool (architecture.md §14, AGENTS.md
 * golden rule 8: raw engine/tactic JSON never reaches the standard-tier
 * coach — a light-tier subagent digests it first). Distinct from
 * episode-fold.ts's EPISODE_FOLD_SYSTEM_PROMPT: this digests structured
 * candidate-move data (engine eval + tactical annotations), not
 * conversation, into a short informational briefing — never a
 * recommendation, since the coach itself decides what to play.
 */
export const CANDIDATE_BRIEFING_SYSTEM_PROMPT =
  'You summarize a list of candidate chess moves (engine eval plus tactical annotations: whether each creates a fork, a hanging piece, an under-defended piece, or changes mobility) into a short briefing (under 120 words) for a coach who is choosing their own next move. State which candidates are sound (near-best eval) and, for each one that would set up a tactic tied to one of the listed focus areas, name the tactic plainly. Do not recommend a single "best" choice — the coach decides; you only inform.';
