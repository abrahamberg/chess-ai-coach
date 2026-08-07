import { parseJsonEventStream, uiMessageChunkSchema } from 'ai';

export interface StreamedToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface StreamedToolOutput {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

export interface CoachStreamHandlers {
  /** An incremental slice of the coach's reply text. */
  onTextDelta: (delta: string) => void;
  /** A tool call with its input fully assembled. Awaited, so a client tool can
   * finish its round-trip before the rest of the stream is drained. */
  onToolCall: (call: StreamedToolCall) => Promise<void>;
  /** architecture §14: play mode's server-executed tools (play_coach_move,
   * undo_last_move) carry `execute`, so the AI SDK resolves them mid-stream
   * with no client round-trip — this is how the frontend hears the result.
   * Optional: analyze mode never emits this chunk type. */
  onToolOutput?: (output: StreamedToolOutput) => void;
  onError: (message: string) => void;
}

/**
 * Reads `POST /api/sessions/:id/messages`. The server sends Server-Sent Events
 * carrying UI message chunks (`text-delta`, `tool-input-available`, ...); this
 * is the one place in apps/web that knows that wire format.
 *
 * Only the chunk types this app acts on are handled. Reasoning chunks are
 * deliberately not among them: the coach's thinking belongs in the debug
 * popup, not the student's transcript. Client tool outputs likewise arrive by
 * their own round-trip rather than off this stream — only server-executed
 * tools' outputs (see onToolOutput) show up here.
 */
export async function readCoachStream(
  body: ReadableStream<Uint8Array>,
  handlers: CoachStreamHandlers
): Promise<void> {
  const chunks = parseJsonEventStream({ stream: body, schema: uiMessageChunkSchema });
  const reader = chunks.getReader();
  // tool-output-available chunks carry no toolName of their own (the AI SDK's
  // uiMessageChunkSchema only puts it on tool-input-available) — remembered
  // here per stream so onToolOutput can still report which tool resolved.
  const toolNamesByCallId = new Map<string, string>();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value.success) {
        handlers.onError('An error occurred.');
        continue;
      }
      await dispatchChunk(value.value, handlers, toolNamesByCallId);
    }
  } finally {
    reader.releaseLock();
  }
}

async function dispatchChunk(
  chunk: { type: string; [key: string]: unknown },
  handlers: CoachStreamHandlers,
  toolNamesByCallId: Map<string, string>
): Promise<void> {
  if (chunk.type === 'text-delta') {
    handlers.onTextDelta(String(chunk.delta ?? ''));
    return;
  }
  if (chunk.type === 'tool-input-available') {
    const toolCallId = String(chunk.toolCallId);
    const toolName = String(chunk.toolName);
    toolNamesByCallId.set(toolCallId, toolName);
    await handlers.onToolCall({ toolCallId, toolName, input: chunk.input });
    return;
  }
  if (chunk.type === 'tool-output-available') {
    const toolCallId = String(chunk.toolCallId);
    handlers.onToolOutput?.({
      toolCallId,
      toolName: toolNamesByCallId.get(toolCallId) ?? '',
      output: chunk.output
    });
    return;
  }
  if (chunk.type === 'error') {
    handlers.onError(String(chunk.errorText ?? 'An error occurred.'));
  }
}
