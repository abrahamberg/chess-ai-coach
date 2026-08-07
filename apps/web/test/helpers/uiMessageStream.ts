/**
 * Builds the Server-Sent Event frames the coach endpoint really emits, so the
 * stream-reading tests assert against the actual wire format rather than an
 * SDK helper's idea of it. One `data: {json}` line per chunk, blank-line
 * terminated — see apps/api/src/llm/stream-response.ts.
 */
function frame(chunk: Record<string, unknown>): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/** Text always arrives as start/delta/end in this protocol; a lone delta with
 * no matching start is not a shape the server can produce. */
export function textFrames(text: string, id = 'text-1'): string[] {
  return [
    frame({ type: 'text-start', id }),
    frame({ type: 'text-delta', id, delta: text }),
    frame({ type: 'text-end', id })
  ];
}

/** A single text delta within an already-started block. */
export function textDeltaFrame(text: string, id = 'text-1'): string {
  return frame({ type: 'text-delta', id, delta: text });
}

export function textStartFrame(id = 'text-1'): string {
  return frame({ type: 'text-start', id });
}

export function toolCallFrame(call: { toolCallId: string; toolName: string; input: unknown }): string {
  return frame({
    type: 'tool-input-available',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input
  });
}

export function toolOutputFrame(toolCallId: string, output: unknown): string {
  return frame({ type: 'tool-output-available', toolCallId, output });
}

export function errorFrame(errorText: string): string {
  return frame({ type: 'error', errorText });
}

/** The coach's thinking summary. Providers stream it as a start/delta/end
 * triple, ahead of the reply text. */
export function reasoningFrames(text: string, id = 'reasoning-1'): string[] {
  return [
    frame({ type: 'reasoning-start', id }),
    frame({ type: 'reasoning-delta', id, delta: text }),
    frame({ type: 'reasoning-end', id })
  ];
}
