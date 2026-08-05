import { parseJsonEventStream, uiMessageChunkSchema } from 'ai';

export interface StreamedToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface CoachStreamHandlers {
  /** An incremental slice of the coach's reply text. */
  onTextDelta: (delta: string) => void;
  /** A tool call with its input fully assembled. Awaited, so a client tool can
   * finish its round-trip before the rest of the stream is drained. */
  onToolCall: (call: StreamedToolCall) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * Reads `POST /api/sessions/:id/messages`. The server sends Server-Sent Events
 * carrying UI message chunks (`text-delta`, `tool-input-available`, ...); this
 * is the one place in apps/web that knows that wire format.
 *
 * Only the chunk types this app acts on are handled. Reasoning chunks are
 * deliberately not among them: the coach's thinking belongs in the debug
 * popup, not the student's transcript. Tool *outputs* likewise arrive by
 * their own round-trip rather than off this stream.
 */
export async function readCoachStream(
  body: ReadableStream<Uint8Array>,
  handlers: CoachStreamHandlers
): Promise<void> {
  const chunks = parseJsonEventStream({ stream: body, schema: uiMessageChunkSchema });
  const reader = chunks.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value.success) {
        handlers.onError('An error occurred.');
        continue;
      }
      await dispatchChunk(value.value, handlers);
    }
  } finally {
    reader.releaseLock();
  }
}

async function dispatchChunk(
  chunk: { type: string; [key: string]: unknown },
  handlers: CoachStreamHandlers
): Promise<void> {
  if (chunk.type === 'text-delta') {
    handlers.onTextDelta(String(chunk.delta ?? ''));
    return;
  }
  if (chunk.type === 'tool-input-available') {
    await handlers.onToolCall({
      toolCallId: String(chunk.toolCallId),
      toolName: String(chunk.toolName),
      input: chunk.input
    });
    return;
  }
  if (chunk.type === 'error') {
    handlers.onError(String(chunk.errorText ?? 'An error occurred.'));
  }
}
