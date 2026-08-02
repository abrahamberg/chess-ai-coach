import type { SessionMessageRow } from '../db/repositories/session-messages.js';

/**
 * design doc §1 addendum: a show_position tool-call is written at the OLD
 * ply (messages in one turn are tagged uniformly with whatever was current
 * when the turn started — the move isn't client-confirmed yet), while its
 * tool-result is written at the NEW ply once the client confirms, one turn
 * later. currentEpisode's plain ply-match scan then starts the new episode
 * at the bare tool-result, with no tool-call earlier in the same episode —
 * a shape both Anthropic and OpenAI reject. This reaches exactly one
 * message further back, across the ply boundary, only when the episode's
 * very first message is such an orphan.
 */
export function includeOrphanedToolCall(
  historyAfterTurn: SessionMessageRow[],
  episodeMessages: SessionMessageRow[]
): SessionMessageRow[] {
  const boundaryIndex = historyAfterTurn.length - episodeMessages.length;
  const adjustedStart = extendPastOrphanedToolResult(historyAfterTurn, boundaryIndex);
  return adjustedStart === boundaryIndex ? episodeMessages : historyAfterTurn.slice(adjustedStart);
}

/**
 * final review #2: shared by includeOrphanedToolCall (the outer episode
 * boundary) and resolveEpisodeReplay's compaction fold point — both cut a
 * message array at some index and both need the same guard: if the message
 * the cut would start on is a tool-result whose toolCallId matches a
 * tool-call earlier in the array, the cut lands between a tool-call and its
 * result, a shape both Anthropic and OpenAI reject. In that case the start
 * index moves back to that tool-call's message, pulling it (and everything
 * after it) in; otherwise the index is returned unchanged.
 *
 * The owning tool-call is usually the immediately preceding message, but one
 * assistant step can make several tool-calls whose results land on separate
 * messages/plies (e.g. a client tool's result, confirmed a turn later, sits
 * after another tool's same-step result was already persisted) — so this
 * walks back through any such sibling tool-result messages to find it,
 * rather than only checking one message back.
 */
export function extendPastOrphanedToolResult(all: SessionMessageRow[], startIndex: number): number {
  const first = all[startIndex];
  const toolCallId = first ? firstToolResultCallId(first) : null;
  if (!toolCallId) return startIndex;

  for (let i = startIndex - 1; i >= 0; i--) {
    const candidate = all[i];
    if (!candidate) break;
    if (hasToolCall(candidate, toolCallId)) return i;
    if (candidate.role !== 'tool') break;
  }
  return startIndex;
}

function firstToolResultCallId(message: SessionMessageRow): string | null {
  if (message.role !== 'tool' || !Array.isArray(message.content)) return null;
  for (const part of message.content) {
    if (typeof part !== 'object' || part === null) continue;
    const candidate = part as { type?: unknown; toolCallId?: unknown };
    if (candidate.type === 'tool-result' && typeof candidate.toolCallId === 'string') return candidate.toolCallId;
  }
  return null;
}

function hasToolCall(message: SessionMessageRow, toolCallId: string): boolean {
  if (!Array.isArray(message.content)) return false;
  return message.content.some((part) => {
    if (typeof part !== 'object' || part === null) return false;
    const candidate = part as { type?: unknown; toolCallId?: unknown };
    return candidate.type === 'tool-call' && candidate.toolCallId === toolCallId;
  });
}
