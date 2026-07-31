/**
 * Coach context restructure design §3, final review #4: the per-episode
 * auto-fold summarizer prompt — distinct from session-context.ts's
 * COMPACTOR_SYSTEM_PROMPT, which is built for a 300-TOKEN whole-session
 * digest (plus an appended OPEN THREADS block). This one produces a single
 * sentence for `session_move_notes.note`, the same slot a coach-authored
 * record_move_note call would fill (capped at 300 CHARACTERS — see
 * recordMoveNoteParameters in tools.ts), so the two paths need to produce
 * comparably-sized artifacts.
 */
export const EPISODE_FOLD_SYSTEM_PROMPT =
  "You compress one chess-coaching move's worth of conversation into a single sentence (aim for under 40 words) describing what was discussed and any conclusion reached. Output only that sentence.";
