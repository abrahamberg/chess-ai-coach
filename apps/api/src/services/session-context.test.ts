import { describe, expect, test, vi } from 'vitest';
import { compact, prepareContext, type StoredMessage } from './session-context.js';

function messagesOfSize(count: number, charsEach: number): StoredMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'x'.repeat(charsEach)
  }));
}

describe('prepareContext', () => {
  test('under budget: replays all messages verbatim, no compaction', () => {
    const messages = messagesOfSize(4, 40); // ~40 tokens total, well under budget

    const result = prepareContext(messages, null, 1000);

    expect(result.needsCompaction).toBe(false);
    expect(result.replayMessages).toEqual(messages);
    expect(result.digest).toBeNull();
  });

  test('over budget: keeps the newest ~half verbatim, needsCompaction is true', () => {
    // 10 messages x 400 chars = 4000 chars = ~1000 tokens, budget 200 -> over.
    const messages = messagesOfSize(10, 400);

    const result = prepareContext(messages, null, 200);

    expect(result.needsCompaction).toBe(true);
    expect(result.replayMessages).toHaveLength(5);
    expect(result.replayMessages).toEqual(messages.slice(5));
    expect(result.replayMessages.map((m) => m.id)).not.toContain('1');
  });

  test('over budget with an existing digest: digest is injected as the first replay message', () => {
    const messages = messagesOfSize(10, 400);

    const result = prepareContext(messages, 'previously: student struggled with king safety', 200);

    expect(result.replayMessages[0]?.id).not.toBe(messages[5]?.id);
    expect(JSON.stringify(result.replayMessages[0]?.content)).toContain('king safety');
    expect(result.replayMessages).toHaveLength(6); // digest + newest 5
  });

  test('under budget with an existing digest: digest is still injected as the first message', () => {
    const messages = messagesOfSize(4, 40);

    const result = prepareContext(messages, 'digest text', 1000);

    expect(result.replayMessages[0]?.content).toContain('digest text');
    expect(result.replayMessages).toHaveLength(5);
    expect(result.needsCompaction).toBe(false);
  });

  test('compaction is not re-triggered within 20 turns of the last compaction, even over budget', () => {
    const messages = messagesOfSize(10, 400);

    const result = prepareContext(messages, 'old digest', 200, 5);

    expect(result.needsCompaction).toBe(false);
    expect(result.replayMessages).toHaveLength(11); // digest + all 10, uncompacted
  });

  test('compaction triggers again once 20 turns have passed since the last compaction', () => {
    const messages = messagesOfSize(10, 400);

    const result = prepareContext(messages, 'old digest', 200, 20);

    expect(result.needsCompaction).toBe(true);
  });
});

describe('compact', () => {
  test('summarizes the folded messages via the injected light-tier callback', async () => {
    const summarize = vi.fn().mockResolvedValue('Student worked on king safety; castled late twice.');
    const toFold: StoredMessage[] = messagesOfSize(4, 40);

    const digest = await compact(toFold, null, summarize);

    expect(digest).toBe('Student worked on king safety; castled late twice.');
    expect(summarize).toHaveBeenCalledOnce();
  });

  test('carries the previous digest forward as input to the summarizer', async () => {
    const summarize = vi.fn().mockResolvedValue('updated digest');
    const toFold: StoredMessage[] = messagesOfSize(2, 40);

    await compact(toFold, 'earlier: worked on hanging pieces', summarize);

    const [prompt] = summarize.mock.calls[0] as [{ system: string; user: string }];
    expect(prompt.user).toContain('hanging pieces');
  });
});
