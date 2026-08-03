import { resolveSanMove } from '@chess-coach/chess-analysis';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { AnnotationNote } from './AnnotationNote.js';
import { ArrowToken } from './ArrowToken.js';
import { splitArrowTokens } from './arrowToken.js';
import { DivergedLineMessage } from './DivergedLineMessage.js';
import { DivergedLineStart } from './DivergedLineStart.js';
import { decodeDivergedLine, decodeDivergedLineStart } from './divergedLine.js';
import { MoveCard } from './MoveCard.js';
import { parseMessageSegments } from './moveMention.js';
import { MoveMention } from './MoveMention.js';
import { PositionContextMessage } from './PositionContextMessage.js';
import { decodeAnnotationNote, decodePositionContext, decodePositionDivider } from './positionDivider.js';
import { PositionDivider } from './PositionDivider.js';

export type HoverMove = { from: string; to: string } | null;

/** design.md §5.3/§5.7: renders a plain message's text with any inline
 * `[e2-e4]`-style arrow references shown as badges (not raw brackets),
 * `**bold**` spans as real emphasis (not literal asterisks), and any SAN
 * move mention resolvable against the current position as a hoverable
 * board reference. */
function renderMessageText(text: string, currentFen: string, onHoverMove?: (move: HoverMove) => void): ReactNode {
  return splitArrowTokens(text).map((segment, index) =>
    segment.type === 'text' ? (
      <Fragment key={index}>{renderTextSegment(segment.value, currentFen, onHoverMove, index)}</Fragment>
    ) : (
      <ArrowToken key={index} from={segment.from} to={segment.to} />
    )
  );
}

function renderTextSegment(
  text: string,
  currentFen: string,
  onHoverMove: ((move: HoverMove) => void) | undefined,
  keyPrefix: number
): ReactNode {
  return parseMessageSegments(text).map((segment, index) => {
    const key = `${keyPrefix}-${index}`;
    if (segment.type === 'text') {
      return segment.bold ? <strong key={key}>{segment.value}</strong> : <Fragment key={key}>{segment.value}</Fragment>;
    }
    const resolved = resolveSanMove(currentFen, segment.san);
    if (!resolved) return segment.bold ? <strong key={key}>{segment.text}</strong> : <Fragment key={key}>{segment.text}</Fragment>;
    return (
      <MoveMention key={key} text={segment.text} bold={segment.bold} from={resolved.from} to={resolved.to} onHover={onHoverMove} />
    );
  });
}

const BOARD_MOVE_PATTERN = /^\[board_move\] I played (\S+) \(position now: (.+)\)$/;

export interface MessageListProps {
  messages: CoachMessage[];
  /** design.md §5.2: mobile board-docking collapses on chat scroll-up. */
  onScrollUp?: () => void;
  /** Clicking a PositionDivider jumps the board to that ply (peek mode). */
  onSelectPly?: (ply: number) => void;
  /** The position currently on the board — resolves SAN move mentions in
   * coach text against it so they can be shown as hoverable references.
   * Defaults to '' (nothing resolves, mentions render as plain/bold text). */
  fen?: string;
  /** Fired on hover/focus of a resolved move mention, and with null on
   * hover/blur-out — lifted by the parent to draw a preview arrow+highlight
   * on the board, in a color distinct from the coach's own annotate_board
   * arrows (design.md §5.3). */
  onHoverMove?: (move: HoverMove) => void;
}

const AT_BOTTOM_THRESHOLD_PX = 24;

/** design.md §5.3: auto-scroll only if the user is already at the bottom —
 * never yank them while reading history. */
export function MessageList({ messages, onScrollUp, onSelectPly, fen = '', onHoverMove }: MessageListProps): ReactNode {
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
              {renderMessageText(message.text, fen, onHoverMove)}
            </p>
          );
        })}
    </div>
  );
}
