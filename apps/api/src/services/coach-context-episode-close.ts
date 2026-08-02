import { EPISODE_FOLD_SYSTEM_PROMPT } from '@chess-coach/prompts';
import { moveRefToPly } from '@chess-coach/chess-analysis';
import type { SessionMessageRow } from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import { compact } from './session-context.js';
import { type CoachContextDependencies, toStoredMessages } from './coach-context-replay.js';

/**
 * Design doc §3: when an episode closes (the coach or the student moves on
 * from `closedPly`) without a coach-authored record_move_note for that ply,
 * fold its raw messages into one automatically so the next turn's
 * other-moves-summary still has something to say about it.
 *
 * Best-effort (final review #3): this runs in the critical path of both its
 * callers (coach-agent.ts's show_position jump-handling and
 * applyClientToolResult), inside the session lock, BEFORE the ply advances
 * and the tool-result is persisted. A transient light-model failure here
 * must never abort the turn — losing one auto-note doesn't corrupt
 * anything, it just leaves that episode's note missing until a later close
 * or an explicit recall_move.
 */
export async function closeEpisodeIfNeeded(
  deps: CoachContextDependencies,
  sessionId: string,
  closedEpisodeMessages: SessionMessageRow[],
  closedPly: number
): Promise<void> {
  if (closedEpisodeMessages.length === 0) return;
  if (hasSuccessfulRecordMoveNoteCall(closedEpisodeMessages, closedPly)) return;

  try {
    // final review #6: seed from this ply's own earlier closing note (e.g.
    // a previous visit's fold), never a hardcoded null — otherwise a
    // revisit's close would silently discard what the first visit already
    // established about this move.
    const existingNote = await sessionMoveNotesRepo.findByPly(deps.db, sessionId, closedPly);
    const note = await compact(
      toStoredMessages(closedEpisodeMessages),
      existingNote?.note ?? null,
      deps.callLightModel,
      EPISODE_FOLD_SYSTEM_PROMPT,
      { appendOpenThreads: false }
    );
    await sessionMoveNotesRepo.upsert(deps.db, sessionId, closedPly, note);
  } catch (error) {
    console.error(`closeEpisodeIfNeeded: failed to auto-fold episode (session ${sessionId}, ply ${closedPly}):`, error);
  }
}

/**
 * final review #7: trusts the tool-CALL and its RESULT, not just the call —
 * if record_move_note returned `{ error: ... }` (e.g. an address that
 * doesn't resolve to a real move in this game), the auto-fallback must
 * still run, or the episode ends up with no note at all. Correlates a
 * record_move_note tool-call for this ply with its tool-result via
 * toolCallId, the same way includeOrphanedToolCall/
 * extendPastOrphanedToolResult correlate a call with its result.
 */
function hasSuccessfulRecordMoveNoteCall(messages: SessionMessageRow[], ply: number): boolean {
  const callIds = collectRecordMoveNoteCallIds(messages, ply);
  if (callIds.size === 0) return false;
  return messages.some((message) => hasSuccessfulToolResult(message, callIds));
}

function collectRecordMoveNoteCallIds(messages: SessionMessageRow[], ply: number): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const callId = recordMoveNoteCallIdForPly(part, ply);
      if (callId) ids.add(callId);
    }
  }
  return ids;
}

function recordMoveNoteCallIdForPly(part: unknown, ply: number): string | null {
  if (typeof part !== 'object' || part === null) return null;
  const candidate = part as { type?: unknown; toolName?: unknown; toolCallId?: unknown; args?: unknown };
  if (candidate.type !== 'tool-call' || candidate.toolName !== 'record_move_note') return null;
  const args = candidate.args as { moveNumber?: unknown; color?: unknown } | undefined;
  if (typeof args?.moveNumber !== 'number') return null;
  const color = (args.color === 'white' || args.color === 'black' ? args.color : null) as 'white' | 'black' | null;
  if (moveRefToPly(args.moveNumber, color) !== ply) return null;
  return typeof candidate.toolCallId === 'string' ? candidate.toolCallId : null;
}

function hasSuccessfulToolResult(message: SessionMessageRow, callIds: Set<string>): boolean {
  if (message.role !== 'tool' || !Array.isArray(message.content)) return false;
  return message.content.some((part) => isSuccessfulRecordMoveNoteResult(part, callIds));
}

function isSuccessfulRecordMoveNoteResult(part: unknown, callIds: Set<string>): boolean {
  if (typeof part !== 'object' || part === null) return false;
  const candidate = part as { type?: unknown; toolCallId?: unknown; result?: unknown };
  if (candidate.type !== 'tool-result' || typeof candidate.toolCallId !== 'string') return false;
  if (!callIds.has(candidate.toolCallId)) return false;
  const result = candidate.result as { recorded?: unknown } | undefined;
  return result?.recorded === true;
}
