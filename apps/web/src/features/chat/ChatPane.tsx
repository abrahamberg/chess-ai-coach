import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ArrowRef } from './arrowToken.js';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { ChipReplyInput } from './ChipReplyInput.js';
import { createEmptyDraft, isDraftEmpty, reconcileArrowChips, serializeDraft, type DraftPart } from './composerDraft.js';
import { DebugPanel } from './DebugPanel.js';
import { MessageList } from './MessageList.js';
import { ThinkingIndicator } from './ThinkingIndicator.js';
import { ToolActivity } from './ToolActivity.js';
import './ChatPane.css';

const NO_ARROWS: ArrowRef[] = [];

export interface ChatPaneProps {
  sessionId: string;
  messages: CoachMessage[];
  activeToolName: string | null;
  /** design.md §5.7: shows the delayed 3-dot typing indicator. */
  isThinking?: boolean;
  onSend: (content: string) => void;
  onScrollUp?: () => void;
  /** Clicking a PositionDivider jumps the board to that ply (peek mode). */
  onSelectPly?: (ply: number) => void;
  /** design.md §5.7: the student's own right-click-drawn arrows, synced into
   * the reply box as chips — CoachBoard's onArrowsChange, lifted by the
   * parent (SessionPage). */
  boardArrows?: ArrowRef[];
}

/** Composes MessageList + ToolActivity + the reply input. No fetching — the
 * parent (SessionPage) owns useCoachChat. The "debug last answer" trigger is
 * the one exception: its data is only ever fetched on demand, when clicked,
 * so DebugPanel owns that fetch itself rather than routing it through
 * useCoachChat. */
export function ChatPane({
  sessionId,
  messages,
  activeToolName,
  isThinking = false,
  onSend,
  onScrollUp,
  onSelectPly,
  boardArrows = NO_ARROWS
}: ChatPaneProps): ReactNode {
  const [parts, setParts] = useState<DraftPart[]>(createEmptyDraft);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const prevArrowsRef = useRef<ArrowRef[]>([]);
  const hasCompletedTurn = messages.some((message) => message.role === 'assistant' && message.text !== '');

  useEffect(() => {
    setParts((current) => reconcileArrowChips(current, prevArrowsRef.current, boardArrows));
    prevArrowsRef.current = boardArrows;
  }, [boardArrows]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (isDraftEmpty(parts)) return;
    onSend(serializeDraft(parts).trim());
    setParts(createEmptyDraft());
  }

  return (
    <div className="chat-pane">
      <div className="chat-pane__header">
        <button
          type="button"
          className="chat-pane__debug-trigger"
          disabled={!hasCompletedTurn}
          title="Debug last answer"
          onClick={() => setIsDebugOpen(true)}
        >
          Debug last answer
        </button>
      </div>
      <MessageList messages={messages} onScrollUp={onScrollUp} onSelectPly={onSelectPly} />
      <ThinkingIndicator visible={isThinking} />
      <ToolActivity toolName={activeToolName} />
      <form onSubmit={handleSubmit}>
        <ChipReplyInput parts={parts} onChange={setParts} />
        <button type="submit">Send</button>
      </form>
      {isDebugOpen && <DebugPanel sessionId={sessionId} onClose={() => setIsDebugOpen(false)} />}
    </div>
  );
}
