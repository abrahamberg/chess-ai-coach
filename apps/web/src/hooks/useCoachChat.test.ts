import { act, renderHook, waitFor } from '@testing-library/react';
import { formatDataStreamPart } from 'ai';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useCoachChat } from './useCoachChat.js';

function streamResponse(parts: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } });
}

describe('useCoachChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('sendMessage posts {content} and streams the assistant reply into messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(streamResponse([formatDataStreamPart('text', 'Hello '), formatDataStreamPart('text', 'there!')]));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCoachChat('session-1'));
    await act(async () => {
      await result.current.sendMessage('hi coach');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session-1/messages',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ content: 'hi coach' }) })
    );
    const last = result.current.messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.text).toBe('Hello there!');
  });

  test('a client tool call invokes onToolCall and posts the result back to the same endpoint', async () => {
    const onToolCall = vi.fn().mockReturnValue({ ply: 4 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([formatDataStreamPart('tool_call', { toolCallId: 'call-1', toolName: 'show_position', args: { ply: 4 } })])
      )
      .mockResolvedValueOnce(streamResponse([formatDataStreamPart('text', 'ok')]));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCoachChat('session-1', { onToolCall }));
    await act(async () => {
      await result.current.sendMessage('show me');
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(onToolCall).toHaveBeenCalledWith({ toolCallId: 'call-1', toolName: 'show_position', args: { ply: 4 } });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/sessions/session-1/messages',
      expect.objectContaining({
        body: JSON.stringify({
          clientToolResult: { toolCallId: 'call-1', toolName: 'show_position', result: { ply: 4 } }
        })
      })
    );
  });

  test('a server-executed tool call (onToolCall returns undefined) does not round-trip', async () => {
    const onToolCall = vi.fn().mockReturnValue(undefined);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      streamResponse([
        formatDataStreamPart('tool_call', { toolCallId: 'call-2', toolName: 'record_finding', args: {} }),
        formatDataStreamPart('text', 'noted')
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCoachChat('session-1', { onToolCall }));
    await act(async () => {
      await result.current.sendMessage('hi');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
