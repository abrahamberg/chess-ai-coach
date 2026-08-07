import { z } from 'zod';
import { COACH_TOOL_SPECS, type CoachToolSpec } from './tools.js';

/** architecture §14 — parameter schemas for play mode's 3 additional tools.
 * Same "implicit current position" convention hypothetical_line already
 * uses: no { moveNumber, color } address, since these always act on
 * whatever is currently on the board (the game's live tip), never a past
 * move. */

export const getCandidateMovesParameters = z.object({
  fen: z.string()
});

export const playCoachMoveParameters = z.object({
  san: z.string().min(1)
});

export const undoLastMoveParameters = z.object({});

/**
 * Single source of truth for play mode's 3 tool descriptions — same
 * verbatim-reuse pattern as tools.ts's COACH_TOOL_SPECS (one canonical
 * description, sent both as the tool-calling schema description and
 * rendered into the play-mode static system prompt).
 */
export const PLAY_TOOL_SPECS: readonly CoachToolSpec[] = [
  {
    name: 'get_candidate_moves',
    description:
      "Get an informational briefing on the current position's sound reply candidates — each annotated with whether it would set up a fork, a hanging piece, an under-defended piece, or a mobility swing, cross-referenced against the student's active focus areas. This tool only INFORMS; it never decides for you. Use it to choose deliberately: sometimes the engine's best move, sometimes a good-but-not-best move that tests a specific skill the student is working on, or something else entirely you want to explore first via hypothetical_line. Pass the fen you got from show_position or check_position — never one you reconstructed yourself."
  },
  {
    name: 'play_coach_move',
    description:
      'Commit YOUR move to the live game as SAN (e.g. "Nf3") — this actually plays it and ends your turn; nothing you say after calling it reaches the student before their next message. Call get_candidate_moves first unless you already know exactly what you want to play. Only call this once you have decided — it is not for trying ideas (use hypothetical_line for that).'
  },
  {
    name: 'undo_last_move',
    description:
      "Reverts the game's last move — only call this after the student has explicitly agreed to an undo you offered (e.g. \"want to take that back?\" → \"yes\"). Never call it silently or preemptively. Ends your turn, same as play_coach_move."
  }
];

export const PLAY_COACH_TOOL_SPECS: readonly CoachToolSpec[] = [...COACH_TOOL_SPECS, ...PLAY_TOOL_SPECS];

export function playCoachToolDescription(name: string): string {
  const spec = PLAY_COACH_TOOL_SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`no description registered for tool "${name}"`);
  return spec.description;
}
