const PREFIX = '[position_divider]';

/** Encodes a coach `show_position` jump as a plain-text sentinel so it can
 * travel through the same string-based CoachMessage.text channel as every
 * other message (matching the existing `[board_move]`/`[session_start]`
 * pattern) and be decoded identically whether it just streamed in live or
 * came back from GET /api/sessions/:id on reload. */
export function encodePositionDivider(ply: number, san: string): string {
  return `${PREFIX}|${ply}|${san}`;
}

export function decodePositionDivider(text: string): { ply: number; san: string } | null {
  if (!text.startsWith(`${PREFIX}|`)) return null;
  const [, ply, san] = text.split('|');
  if (ply === undefined || san === undefined) return null;
  return { ply: Number(ply), san };
}

/** ply N's "after <san>" is the move that reached it — sanMoves[N-1] (0-indexed,
 * ply 0 is the start position with no preceding move). */
export function sanForPly(sanMoves: string[], ply: number): string | null {
  if (ply <= 0) return null;
  return sanMoves[ply - 1] ?? null;
}

/** Converts a ply (1-indexed half-move count) to standard chess move-pair
 * notation: White plays ply 2N-1, Black plays ply 2N, both as "move N". */
export function describePly(ply: number): { moveNumber: number; color: 'white' | 'black' } {
  return { moveNumber: Math.ceil(ply / 2), color: ply % 2 === 1 ? 'white' : 'black' };
}

export interface AnnotationNoteState {
  arrows: { from: string; to: string; color: string }[];
  highlights: { square: string; color: string }[];
}

const ANNOTATION_PREFIX = '[annotation_note]';

/** Encodes an annotate_board call as a plain-text sentinel, same pattern as
 * encodePositionDivider — travels through the string-based CoachMessage.text
 * channel and round-trips through GET /api/sessions/:id on reload. */
export function encodeAnnotationNote(state: AnnotationNoteState): string {
  return `${ANNOTATION_PREFIX}|${JSON.stringify(state)}`;
}

export function decodeAnnotationNote(text: string): AnnotationNoteState | null {
  if (!text.startsWith(`${ANNOTATION_PREFIX}|`)) return null;
  try {
    return JSON.parse(text.slice(ANNOTATION_PREFIX.length + 1)) as AnnotationNoteState;
  } catch {
    return null;
  }
}

/** design.md-adjacent: a short human-readable summary of what the coach drew
 * — "e2→e4" for arrows, "highlighted d5" for highlights — so a persistent
 * chat note can say what happened without the student needing to scroll back
 * to the board. */
export function describeAnnotation(state: AnnotationNoteState): string {
  const parts: string[] = [];
  if (state.arrows.length > 0) parts.push(state.arrows.map((arrow) => `${arrow.from}→${arrow.to}`).join(', '));
  if (state.highlights.length > 0) parts.push(`highlighted ${state.highlights.map((h) => h.square).join(', ')}`);
  return parts.join('; ');
}

const CONTEXT_PATTERN = /^\[position_context\] Back at move (\d+) \((white|black)\), after (\S+): ([\s\S]*)$/;

/** Encodes a student message sent while the board is peeked away from the
 * coach's last shown position (e.g. after clicking a PositionDivider to jump
 * back to an earlier move) — unlike encodePositionDivider/encodeAnnotationNote
 * (client-synthesized, never read by the model), this text becomes the actual
 * user turn sent to the coach, so it reads as natural language — same
 * pattern as the `[board_move]` message SessionPage sends for a dragged move. */
export function encodePositionContext(ply: number, san: string, content: string): string {
  const { moveNumber, color } = describePly(ply);
  return `[position_context] Back at move ${moveNumber} (${color}), after ${san}: ${content}`;
}

export function decodePositionContext(
  text: string
): { moveNumber: number; color: 'white' | 'black'; san: string; content: string } | null {
  const match = text.match(CONTEXT_PATTERN);
  if (!match) return null;
  const [, moveNumber, color, san, content] = match;
  return { moveNumber: Number(moveNumber), color: color as 'white' | 'black', san: san ?? '', content: content ?? '' };
}
