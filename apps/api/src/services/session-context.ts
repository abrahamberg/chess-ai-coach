import type { Thread } from '@chess-coach/shared';
import { isToolResultPart, toolResultValue } from '../lib/tool-parts.js';

const CHARS_PER_TOKEN = 4;
const COMPACTION_COOLDOWN_TURNS = 20;

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: unknown;
}

export interface PrepareContextResult {
  digest: string | null;
  replayMessages: StoredMessage[];
  needsCompaction: boolean;
}

/**
 * architecture §8.2: bounds the coach's replayed conversation to `budgetTokens`
 * (estimated at 4 chars/token, no tokenizer dependency). When over budget, the
 * newest ~half of messages replay verbatim and the caller should `compact()`
 * the rest into a fresh digest. Compaction is rate-limited to at most once per
 * 20 turns (`turnsSinceLastCompaction`) even if still over budget, so a single
 * oversized turn can't trigger back-to-back compaction calls.
 */
export function prepareContext(
  messages: StoredMessage[],
  digest: string | null,
  budgetTokens: number,
  turnsSinceLastCompaction = Infinity
): PrepareContextResult {
  const overBudget = estimateTokens(messages) > budgetTokens;
  const onCooldown = turnsSinceLastCompaction < COMPACTION_COOLDOWN_TURNS;
  const needsCompaction = overBudget && !onCooldown;

  const kept = needsCompaction ? messages.slice(Math.ceil(messages.length / 2)) : messages;
  return { digest, replayMessages: withDigestMessage(digest, kept), needsCompaction };
}

function withDigestMessage(digest: string | null, messages: StoredMessage[]): StoredMessage[] {
  if (!digest) return messages;
  const digestMessage: StoredMessage = { id: 'digest', role: 'user', content: `[session so far] ${digest}` };
  return [digestMessage, ...messages];
}

function estimateTokens(messages: StoredMessage[]): number {
  const chars = messages.reduce((sum, message) => sum + JSON.stringify(message.content).length, 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export type SummarizeFn = (prompt: { system: string; user: string }) => Promise<string>;

/** Whole-session rolling-digest prompt (architecture §8.2's original
 * design). Exported so every caller passes it explicitly rather than
 * `compact()` hardcoding it (final review #4) — the per-episode auto-fold
 * path (coach-context.ts's closeEpisodeIfNeeded/resolveEpisodeReplay) needs
 * a different, much shorter prompt (packages/prompts's
 * EPISODE_FOLD_SYSTEM_PROMPT) instead. */
export const COMPACTOR_SYSTEM_PROMPT =
  'You compress old chess-coaching conversation turns into a rolling "session so far" digest of at most 300 tokens: positions covered, the student\'s answers, and findings recorded. Carry forward any open or parked conversation threads verbatim; resolved threads may be dropped. Output only the digest text.';

export interface CompactOptions {
  /** Append the OPEN THREADS block (verbatim, from the latest update_threads
   * result among the folded messages) after the LLM digest. Defaults to
   * true, matching the original whole-session behavior. The per-episode
   * auto-fold path passes false (final review #4): layer 5 already renders
   * the thread ledger separately every turn, so appending it again to a
   * one-sentence move note would just duplicate it. */
  appendOpenThreads?: boolean;
}

/**
 * Light-tier summarization (architecture §8.2); `summarize` is injected so this
 * is testable without the AI SDK or a real provider call. `systemPrompt` is
 * caller-supplied (final review #4) — pass COMPACTOR_SYSTEM_PROMPT for the
 * original whole-session digest behavior, or a shorter purpose-built prompt
 * for other folding contexts (e.g. packages/prompts's
 * EPISODE_FOLD_SYSTEM_PROMPT for a single episode).
 *
 * Task 5.5: any `update_threads` tool result among the folded messages has its
 * open/parked threads appended to the digest verbatim (not passed through the
 * LLM) — the compactor carries the ledger forward exactly, resolved threads
 * are dropped. Only the latest such result is used, since it supersedes
 * earlier ones (update_threads is a full-replace). Skipped entirely when
 * `options.appendOpenThreads` is false.
 */
export async function compact(
  messagesToFold: StoredMessage[],
  previousDigest: string | null,
  summarize: SummarizeFn,
  systemPrompt: string,
  options: CompactOptions = {}
): Promise<string> {
  const transcript = messagesToFold
    .map((message) => `${message.role}: ${JSON.stringify(message.content)}`)
    .join('\n');
  const user = previousDigest
    ? `PREVIOUS DIGEST\n${previousDigest}\n\nNEW TURNS TO FOLD IN\n${transcript}`
    : `TURNS TO SUMMARIZE\n${transcript}`;

  const llmDigest = await summarize({ system: systemPrompt, user });

  if (options.appendOpenThreads === false) return llmDigest;

  const openThreads = latestOpenThreads(messagesToFold);
  if (openThreads.length === 0) return llmDigest;

  return `${llmDigest}\n\nOPEN THREADS (carried forward verbatim):\n${renderThreads(openThreads)}`;
}

function latestOpenThreads(messages: StoredMessage[]): Thread[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const threads = extractUpdateThreadsResult(messages[i]);
    if (threads) return threads.filter((thread) => thread.status !== 'resolved');
  }
  return [];
}

function extractUpdateThreadsResult(message: StoredMessage | undefined): Thread[] | null {
  if (!message || message.role !== 'tool' || !Array.isArray(message.content)) return null;
  for (const part of message.content) {
    if (isUpdateThreadsResultPart(part)) return toolResultValue(part) as Thread[];
  }
  return null;
}

function isUpdateThreadsResultPart(part: unknown): boolean {
  if (!isToolResultPart(part)) return false;
  const candidate = part as { toolName?: unknown };
  return candidate.toolName === 'update_threads' && Array.isArray(toolResultValue(part));
}

function renderThreads(threads: Thread[]): string {
  return threads
    .map((thread) => `- ${thread.topic}${thread.hypothesis ? ` (hypothesis: ${thread.hypothesis})` : ''}`)
    .join('\n');
}
