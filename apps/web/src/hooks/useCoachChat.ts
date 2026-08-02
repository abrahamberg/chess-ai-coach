import { moveRefToPly } from '@chess-coach/chess-analysis';
import { processDataStream } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeDivergedLineStart } from '../features/chat/divergedLine.js';
import { encodeAnnotationNote, encodePositionDivider, sanForPly, type AnnotationNoteState } from '../features/chat/positionDivider.js';

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
  /** design.md §5.3: SAN of every played move, used to label a show_position
   * jump as "— move N, after <SAN> —" in the transcript. */
  sanMoves?: string[];
}

export interface UseCoachChatResult {
  messages: CoachMessage[];
  isStreaming: boolean;
  /** design.md §5.3: the tool currently in flight this turn, or null between
   * turns / once the coach's text resumes. ToolActivity decides which tool
   * names actually render something (most are backstage). */
  activeToolName: string | null;
  /** design.md §5.7: true while waiting for the coach's first token this
   * turn (the empty assistant placeholder hasn't received any text yet). */
  isThinking: boolean;
  sendMessage: (content: string) => Promise<void>;
  /** Resumes a turn on whatever's already pending in history (the
   * [session_start] marker) without adding a new user-role message — how the
   * coach opens a fresh session on its own. */
  kickoff: () => Promise<void>;
}

/** Drives POST /api/sessions/:id/messages (architecture §7.2). Built on AI
 * SDK's low-level processDataStream rather than useChat: useChat's wire
 * protocol (a resubmitted {messages: [...]} array) doesn't match this
 * project's {content} / {clientToolResult} request contract. */
export function useCoachChat(sessionId: string, options: UseCoachChatOptions = {}): UseCoachChatResult {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);

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

      try {
        await processDataStream({
          stream: response.body,
          onTextPart: (delta) => {
            setActiveToolName(null);
            assistantText += delta;
            setMessages((prev) =>
              prev.map((message) => (message.id === assistantId ? { ...message, text: assistantText } : message))
            );
          },
          onToolCallPart: async (toolCall) => {
            setActiveToolName(toolCall.toolName);
            if (toolCall.toolName === 'show_position') {
              const { moveNumber, color } = toolCall.args as { moveNumber: number; color: 'white' | 'black' | null };
              const ply = moveRefToPly(moveNumber, color);
              const san = sanForPly(options.sanMoves ?? [], ply);
              if (san) {
                setMessages((prev) => [
                  ...prev,
                  { id: crypto.randomUUID(), role: 'assistant', text: encodePositionDivider(ply, san) }
                ]);
              }
            }
            if (toolCall.toolName === 'annotate_board') {
              const annotation = toolCall.args as AnnotationNoteState;
              if (annotation.arrows.length > 0 || annotation.highlights.length > 0) {
                setMessages((prev) => [
                  ...prev,
                  { id: crypto.randomUUID(), role: 'assistant', text: encodeAnnotationNote(annotation) }
                ]);
              }
            }
            const result = options.onToolCall?.(toolCall);
            if (toolCall.toolName === 'hypothetical_line' && result !== undefined) {
              const hypothetical = result as { ok: boolean; basePly: number; moves: { san: string }[]; resultFen?: string };
              if (hypothetical.moves.length > 0) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    text: encodeDivergedLineStart({
                      basePly: hypothetical.basePly,
                      sanMoves: hypothetical.moves.map((move) => move.san),
                      resultFen: hypothetical.resultFen ?? ''
                    })
                  }
                ]);
              }
            }
            if (result !== undefined) {
              await postTurn({
                clientToolResult: { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result }
              });
            }
          }
        });
      } finally {
        setActiveToolName(null);
      }
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

  const kickoff = useCallback(async () => {
    setIsStreaming(true);
    try {
      await postTurn({});
    } finally {
      setIsStreaming(false);
    }
  }, [postTurn]);

  const isThinking = isStreaming && messages.at(-1)?.text === '';

  return { messages, isStreaming, activeToolName, isThinking, sendMessage, kickoff };
}
