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

const COMPACTOR_SYSTEM_PROMPT =
  'You compress old chess-coaching conversation turns into a rolling "session so far" digest of at most 300 tokens: positions covered, the student\'s answers, and findings recorded. Carry forward any open or parked conversation threads verbatim; resolved threads may be dropped. Output only the digest text.';

/** Light-tier summarization (architecture §8.2); `summarize` is injected so this
 * is testable without the AI SDK or a real provider call. */
export async function compact(
  messagesToFold: StoredMessage[],
  previousDigest: string | null,
  summarize: SummarizeFn
): Promise<string> {
  const transcript = messagesToFold
    .map((message) => `${message.role}: ${JSON.stringify(message.content)}`)
    .join('\n');
  const user = previousDigest
    ? `PREVIOUS DIGEST\n${previousDigest}\n\nNEW TURNS TO FOLD IN\n${transcript}`
    : `TURNS TO SUMMARIZE\n${transcript}`;

  return summarize({ system: COMPACTOR_SYSTEM_PROMPT, user });
}
