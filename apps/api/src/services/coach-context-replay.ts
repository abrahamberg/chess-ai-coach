import type { ChatMessage } from '../llm/messages.js';
import type { Kysely } from 'kysely';
import { EPISODE_FOLD_SYSTEM_PROMPT } from '@chess-coach/prompts';
import type { SessionMessageRow } from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import type { Database } from '../db/schema.js';
import { compact, prepareContext, type StoredMessage, type SummarizeFn } from './session-context.js';
import { extendPastOrphanedToolResult } from './coach-context-orphan-boundary.js';
import { upgradeStoredParts } from '../lib/tool-parts.js';

const EPISODE_BUDGET_TOKENS = 6000;

export interface CoachContextDependencies {
  db: Kysely<Database>;
  callLightModel: SummarizeFn;
}

/**
 * Long-running-episode safety net (design doc §3): reuses session-
 * context.ts's budget/cooldown compaction, scoped to just this episode.
 * `findByPly` may return a note from *this same* open episode's own earlier
 * fold, or — on a revisit — the closing note from an *earlier, separate*
 * visit to this exact ply. Either way it's used as the seed digest: on a
 * revisit that's a deliberate, small carry-over ("what did we already
 * conclude about this move last time"), not the raw-replay confusion the
 * episode boundary exists to prevent — only a past visit's *raw messages*
 * are excluded from this episode's scan (lib/episodes.ts's currentEpisode),
 * never its one-line note.
 */
export async function resolveEpisodeReplay(
  deps: CoachContextDependencies,
  sessionId: string,
  episodeMessages: SessionMessageRow[],
  currentPly: number
): Promise<ChatMessage[]> {
  const stored = toStoredMessages(episodeMessages);
  const existingNote = await sessionMoveNotesRepo.findByPly(deps.db, sessionId, currentPly);
  const initialDigest = existingNote?.note ?? null;
  const prepared = prepareContext(stored, initialDigest, EPISODE_BUDGET_TOKENS);

  if (!prepared.needsCompaction) {
    return withEpisodeDigest(initialDigest, stored).map(toChatMessage);
  }

  const keptCount = Math.ceil(stored.length / 2);
  if (keptCount === stored.length) {
    // Nothing left to fold (e.g. a single oversized message) — replay
    // verbatim rather than compacting an empty slice and clobbering the
    // note for no token savings.
    return withEpisodeDigest(initialDigest, stored).map(toChatMessage);
  }

  // final review #2: the naive fold point (stored.length - keptCount) is
  // purely positional — it can land between a server-executed tool-call and
  // its tool-result (get_engine_analysis, check_position, record_finding,
  // update_threads all persist that adjacent pair). If it does, `kept`
  // would start with a bare tool_result, a shape both Anthropic and OpenAI
  // reject — and since the provider rejection means onFinish never runs,
  // the same bad cut would recur every subsequent turn. Same fix as
  // includeOrphanedToolCall uses for the outer episode boundary: extend the
  // cut back one message when it lands on an orphaned tool-result.
  const keptStart = extendPastOrphanedToolResult(episodeMessages, stored.length - keptCount);
  const foldedMessages = stored.slice(0, keptStart);
  const newDigest = await compact(
    foldedMessages,
    initialDigest,
    deps.callLightModel,
    EPISODE_FOLD_SYSTEM_PROMPT,
    { appendOpenThreads: false }
  );
  await sessionMoveNotesRepo.upsert(deps.db, sessionId, currentPly, newDigest);

  const kept = stored.slice(keptStart);
  return withEpisodeDigest(newDigest, kept).map(toChatMessage);
}

function withEpisodeDigest(digest: string | null, messages: StoredMessage[]): StoredMessage[] {
  if (!digest) return messages;
  const digestMessage: StoredMessage = { id: 'digest', role: 'user', content: `[this move so far] ${digest}` };
  return [digestMessage, ...messages];
}

export function toStoredMessages(messages: SessionMessageRow[]): StoredMessage[] {
  return messages.map((message) => ({ id: message.id, role: message.role, content: message.content }));
}

function toChatMessage(message: StoredMessage): ChatMessage {
  return { role: message.role, content: upgradeStoredParts(message.content) } as ChatMessage;
}
