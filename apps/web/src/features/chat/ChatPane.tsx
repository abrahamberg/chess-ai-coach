import type { ParsedPosition } from '@chess-coach/chess-analysis';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ArrowRef } from './arrowToken.js';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { ChipReplyInput } from './ChipReplyInput.js';
import { createEmptyDraft, isDraftEmpty, reconcileArrowChips, serializeDraft, type DraftPart } from './composerDraft.js';
import { DebugPanel } from './DebugPanel.js';
import { MessageList, type HoverMove } from './MessageList.js';
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
  /** Clicking a PositionDivider jumps the board to that ply (peek mode). */
  onSelectPly?: (ply: number) => void;
  /** design.md §5.7: the student's own right-click-drawn arrows, synced into
   * the reply box as chips — CoachBoard's onArrowsChange, lifted by the
   * parent (SessionPage). */
  boardArrows?: ArrowRef[];
  /** True while a diverged line is pending — Send should be
   * allowed even with an empty text draft, since the line itself (bundled
   * in by the parent's onSend) is the content being submitted. */
  hasPendingLine?: boolean;
  /** The position currently on the board — passed through to MessageList so
   * it can resolve SAN move mentions in coach text (design.md §5.3). */
  fen?: string;
  /** Every ply's FEN for the game being reviewed — passed through to
   * MessageList so a numbered move mention resolves against the position it
   * names, not whatever is currently on the board (design.md §5.3). */
  positions?: ParsedPosition[];
  /** Fired on hover/focus of a resolved move mention; lifted by the parent
   * to preview it on the board. */
  onHoverMove?: (move: HoverMove) => void;
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
  onSelectPly,
  boardArrows = NO_ARROWS,
  hasPendingLine = false,
  fen,
  positions,
  onHoverMove
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
    if (isDraftEmpty(parts) && !hasPendingLine) return;
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
      <MessageList
        messages={messages}
        onSelectPly={onSelectPly}
        fen={fen}
        positions={positions}
        onHoverMove={onHoverMove}
      />
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
