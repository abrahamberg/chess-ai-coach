import { describe, expect, test, vi } from 'vitest';
import { toolCallFrame, toolOutputFrame } from '../../test/helpers/uiMessageStream.js';
import { readCoachStream } from './coachStream.js';

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  });
}

function handlers(overrides: Partial<Parameters<typeof readCoachStream>[1]> = {}) {
  return {
    onTextDelta: vi.fn(),
    onToolCall: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    ...overrides
  };
}

describe('readCoachStream — tool-output-available forwarding', () => {
  // architecture §14: play_coach_move/undo_last_move are server-executed
  // tools (they have `execute`), so the AI SDK emits a tool-output-available
  // chunk mid-stream with no client round-trip. That chunk carries no
  // toolName of its own (see ai's uiMessageChunkSchema) — only the matching
  // tool-input-available chunk earlier in the same stream does — so the
  // stream reader must remember it.
  test('onToolOutput receives the toolName recalled from the earlier tool-input-available chunk', async () => {
    const onToolOutput = vi.fn();
    const stream = streamOf([
      toolCallFrame({ toolCallId: 'call-1', toolName: 'play_coach_move', input: { san: 'Nf3' } }),
      toolOutputFrame('call-1', { fen: 'some-fen', san: 'Nf3', ply: 3, quality: 'best' })
    ]);

    await readCoachStream(stream, handlers({ onToolOutput }));

    expect(onToolOutput).toHaveBeenCalledWith({
      toolCallId: 'call-1',
      toolName: 'play_coach_move',
      output: { fen: 'some-fen', san: 'Nf3', ply: 3, quality: 'best' }
    });
  });

  test('a stream with no onToolOutput handler does not throw when a tool-output-available chunk arrives', async () => {
    const stream = streamOf([
      toolCallFrame({ toolCallId: 'call-2', toolName: 'undo_last_move', input: {} }),
      toolOutputFrame('call-2', { fen: 'fen-after-undo', removedPly: 2 })
    ]);

    await expect(readCoachStream(stream, handlers())).resolves.toBeUndefined();
  });

  test('a tool-output-available chunk with no matching tool-input-available still forwards, with an empty toolName', async () => {
    const onToolOutput = vi.fn();
    const stream = streamOf([toolOutputFrame('call-3', { ok: true })]);

    await readCoachStream(stream, handlers({ onToolOutput }));

    expect(onToolOutput).toHaveBeenCalledWith({ toolCallId: 'call-3', toolName: '', output: { ok: true } });
  });
});
