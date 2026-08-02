import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { AnnotationNote } from './AnnotationNote.js';
import { ArrowToken } from './ArrowToken.js';
import { splitArrowTokens } from './arrowToken.js';
import { DivergedLineMessage } from './DivergedLineMessage.js';
import { DivergedLineStart } from './DivergedLineStart.js';
import { decodeDivergedLine, decodeDivergedLineStart } from './divergedLine.js';
import { MoveCard } from './MoveCard.js';
import { PositionContextMessage } from './PositionContextMessage.js';
import { decodeAnnotationNote, decodePositionContext, decodePositionDivider } from './positionDivider.js';
import { PositionDivider } from './PositionDivider.js';

/** design.md §5.7: renders a plain message's text with any inline
 * `[e2-e4]`-style arrow references shown as badges, not raw brackets. */
function renderMessageText(text: string): ReactNode {
  return splitArrowTokens(text).map((segment, index) =>
    segment.type === 'text' ? (
      <Fragment key={index}>{segment.value}</Fragment>
    ) : (
      <ArrowToken key={index} from={segment.from} to={segment.to} />
    )
  );
}

const BOARD_MOVE_PATTERN = /^\[board_move\] I played (\S+) \(position now: (.+)\)$/;

export interface MessageListProps {
  messages: CoachMessage[];
  /** design.md §5.2: mobile board-docking collapses on chat scroll-up. */
  onScrollUp?: () => void;
  /** Clicking a PositionDivider jumps the board to that ply (peek mode). */
  onSelectPly?: (ply: number) => void;
}

const AT_BOTTOM_THRESHOLD_PX = 24;

/** design.md §5.3: auto-scroll only if the user is already at the bottom —
 * never yank them while reading history. */
export function MessageList({ messages, onScrollUp, onSelectPly }: MessageListProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  function handleScroll(): void {
    const el = containerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
    if (!isAtBottomRef.current) onScrollUp?.();
  }

  useEffect(() => {
    const el = containerRef.current;
    if (el && isAtBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages]);

  return (
    <div ref={containerRef} onScroll={handleScroll} data-testid="message-list" aria-live="polite">
      {messages
        .filter((message) => message.text.trim() !== '')
        .map((message, index, visible) => {
          const boardMove = message.text.match(BOARD_MOVE_PATTERN);
          if (boardMove) {
            const [, san, fen] = boardMove;
            return <MoveCard key={message.id} san={san ?? ''} fen={fen ?? ''} />;
          }
          const divider = decodePositionDivider(message.text);
          if (divider) {
            return <PositionDivider key={message.id} ply={divider.ply} san={divider.san} onSelect={onSelectPly} />;
          }
          const annotation = decodeAnnotationNote(message.text);
          if (annotation) {
            return <AnnotationNote key={message.id} arrows={annotation.arrows} highlights={annotation.highlights} />;
          }
          const context = decodePositionContext(message.text);
          if (context) {
            return (
              <PositionContextMessage
                key={message.id}
                moveNumber={context.moveNumber}
                color={context.color}
                san={context.san}
                content={context.content}
              />
            );
          }
          const divergedLineStart = decodeDivergedLineStart(message.text);
          if (divergedLineStart) {
            return (
              <DivergedLineStart key={message.id} basePly={divergedLineStart.basePly} sanMoves={divergedLineStart.sanMoves} />
            );
          }
          const divergedLine = decodeDivergedLine(message.text);
          if (divergedLine) {
            return (
              <DivergedLineMessage
                key={message.id}
                basePly={divergedLine.basePly}
                sanText={divergedLine.sanText}
                content={divergedLine.content}
              />
            );
          }
          // design.md §5.3: one small avatar at the start of each coach run,
          // not on every message — only when the previous visible message
          // wasn't also from the assistant.
          const startsCoachRun = message.role === 'assistant' && visible[index - 1]?.role !== 'assistant';
          return (
            <p key={message.id} data-role={message.role}>
              {startsCoachRun && (
                <span className="coach-avatar" aria-hidden="true">
                  ♞
                </span>
              )}
              {renderMessageText(message.text)}
            </p>
          );
        })}
    </div>
  );
}
