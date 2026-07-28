import { processDataStream } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface CoachMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface CoachToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface UseCoachChatOptions {
  /** Client tools (show_position, annotate_board): return the tool result to
   * round-trip it back to the coach. Return undefined for server-executed
   * tools — their result already arrived in the same stream. */
  onToolCall?: (toolCall: CoachToolCall) => unknown;
  /** Prior turns from GET /api/sessions/:id, so reopening an in-progress
   * session shows its transcript instead of starting blank. */
  initialMessages?: CoachMessage[];
}

export interface UseCoachChatResult {
  messages: CoachMessage[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;
}

/** Drives POST /api/sessions/:id/messages (architecture §7.2). Built on AI
 * SDK's low-level processDataStream rather than useChat: useChat's wire
 * protocol (a resubmitted {messages: [...]} array) doesn't match this
 * project's {content} / {clientToolResult} request contract. */
export function useCoachChat(sessionId: string, options: UseCoachChatOptions = {}): UseCoachChatResult {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // The session/game fetch (SessionPage) resolves after this hook's first
  // render, so initialMessages arrives on a later render, not at mount —
  // seed once when it shows up rather than via useState's lazy initializer.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && options.initialMessages && options.initialMessages.length > 0) {
      seededRef.current = true;
      setMessages(options.initialMessages);
    }
  }, [options.initialMessages]);

  const postTurn = useCallback(
    async (body: { content?: string } | { clientToolResult: { toolCallId: string; toolName: string; result: unknown } }) => {
      const response = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.body) return;

      const assistantId = crypto.randomUUID();
      let assistantText = '';
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', text: '' }]);

      await processDataStream({
        stream: response.body,
        onTextPart: (delta) => {
          assistantText += delta;
          setMessages((prev) =>
            prev.map((message) => (message.id === assistantId ? { ...message, text: assistantText } : message))
          );
        },
        onToolCallPart: async (toolCall) => {
          const result = options.onToolCall?.(toolCall);
          if (result !== undefined) {
            await postTurn({
              clientToolResult: { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result }
            });
          }
        }
      });
    },
    [sessionId, options]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: content }]);
      setIsStreaming(true);
      try {
        await postTurn({ content });
      } finally {
        setIsStreaming(false);
      }
    },
    [postTurn]
  );

  return { messages, isStreaming, sendMessage };
}
