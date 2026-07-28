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
