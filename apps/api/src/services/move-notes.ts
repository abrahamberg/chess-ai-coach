import type { Kysely } from 'kysely';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import type { Database } from '../db/schema.js';
import { getPositionAtPly } from './game-positions.js';
import { compact, type SummarizeFn } from './session-context.js';

export interface MoveNotesDependencies {
  db: Kysely<Database>;
  callLightModel: SummarizeFn;
}

export interface MoveNotesContext {
  sessionId: string;
  gameId: string;
}

/** record_move_note tool (design doc §3): coach-authored, validated the
 * same way check_position validates a ply — against the game's real move
 * list, never trusting the model's own arithmetic. */
export async function recordMoveNote(
  db: Kysely<Database>,
  ctx: MoveNotesContext,
  args: { ply: number; note: string }
): Promise<{ recorded: boolean } | { error: string }> {
  const position = await getPositionAtPly(db, ctx.gameId, args.ply);
  if (!position) return { error: 'that move does not exist in this game' };
  await sessionMoveNotesRepo.upsert(db, ctx.sessionId, args.ply, args.note);
  return { recorded: true };
}

/** recall_move tool (design doc §4): a fresh on-demand digest of a past
 * episode's full raw conversation — richer than the always-present
 * other-moves-summary line, which is just the closing note. Falls back to
 * that same note when the raw messages are gone (already folded), and to
 * an explicit "nothing recorded" when neither exists. */
export async function recallMove(
  deps: MoveNotesDependencies,
  ctx: MoveNotesContext & { currentPly: number },
  requestedPly: number
): Promise<{ text: string } | { error: string }> {
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
  const text = await compact(stored, null, deps.callLightModel);
  return { text };
}
