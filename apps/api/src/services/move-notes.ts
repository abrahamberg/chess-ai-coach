import type { Kysely } from 'kysely';
import { moveRefToPly } from '@chess-coach/chess-analysis';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import type { Database } from '../db/schema.js';
import { getPositionAtPly } from './game-positions.js';
import { compact, COMPACTOR_SYSTEM_PROMPT, type SummarizeFn } from './session-context.js';

export interface MoveNotesDependencies {
  db: Kysely<Database>;
  callLightModel: SummarizeFn;
}

export interface MoveNotesContext {
  sessionId: string;
  gameId: string;
}

export interface MoveAddress {
  moveNumber: number;
  color: 'white' | 'black' | null;
}

/** record_move_note tool (design doc §3): coach-authored, validated the
 * same way check_position validates a ply — against the game's real move
 * list, never trusting the model's own arithmetic. Tool-facing address is
 * { moveNumber, color } (final review #1) — the ply conversion happens
 * here, at the top, before any validation; session_move_notes itself
 * stays keyed by ply internally. */
export async function recordMoveNote(
  db: Kysely<Database>,
  ctx: MoveNotesContext,
  args: MoveAddress & { note: string }
): Promise<{ recorded: boolean } | { error: string }> {
  const ply = moveRefToPly(args.moveNumber, args.color);
  const position = await getPositionAtPly(db, ctx.gameId, ply);
  if (!position) return { error: 'that move does not exist in this game' };
  await sessionMoveNotesRepo.upsert(db, ctx.sessionId, ply, args.note);
  return { recorded: true };
}

/** recall_move tool (design doc §4): a fresh on-demand digest of a past
 * episode's full raw conversation — richer than the always-present
 * other-moves-summary line, which is just the closing note. Falls back to
 * that same note when the raw messages are gone (already folded), and to
 * an explicit "nothing recorded" when neither exists. Tool-facing address
 * is { moveNumber, color } (final review #1), converted to a ply up front;
 * everything below stays ply-keyed. Still uses the whole-session-style
 * compactor prompt (COMPACTOR_SYSTEM_PROMPT) rather than the short
 * per-episode-fold one (final review #4) — recall_move deliberately wants
 * a richer on-demand digest than the one-sentence auto-fold note. */
export async function recallMove(
  deps: MoveNotesDependencies,
  ctx: MoveNotesContext & { currentPly: number },
  requested: MoveAddress
): Promise<{ text: string } | { error: string }> {
  const requestedPly = moveRefToPly(requested.moveNumber, requested.color);
  if (requestedPly === ctx.currentPly) {
    return { text: "that's the position you're already discussing — it's already in view." };
  }

  const position = await getPositionAtPly(deps.db, ctx.gameId, requestedPly);
  if (!position) return { error: 'that move does not exist in this game' };

  const messages = await sessionMessagesRepo.listBySessionAndPly(deps.db, ctx.sessionId, requestedPly);
  if (messages.length === 0) {
    const note = await sessionMoveNotesRepo.findByPly(deps.db, ctx.sessionId, requestedPly);
    return note ? { text: note.note } : { text: 'nothing recorded for that move yet' };
  }

  const stored = messages.map((message) => ({ id: message.id, role: message.role, content: message.content }));
  const text = await compact(stored, null, deps.callLightModel, COMPACTOR_SYSTEM_PROMPT);
  return { text };
}
