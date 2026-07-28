import { useEffect, useRef, type ReactNode } from 'react';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { MoveCard } from './MoveCard.js';
import { decodePositionDivider } from './positionDivider.js';
import { PositionDivider } from './PositionDivider.js';

const BOARD_MOVE_PATTERN = /^\[board_move\] I played (\S+) \(position now: (.+)\)$/;

export interface MessageListProps {
  messages: CoachMessage[];
  /** design.md §5.2: mobile board-docking collapses on chat scroll-up. */
  onScrollUp?: () => void;
}

const AT_BOTTOM_THRESHOLD_PX = 24;

/** design.md §5.3: auto-scroll only if the user is already at the bottom —
 * never yank them while reading history. */
export function MessageList({ messages, onScrollUp }: MessageListProps): ReactNode {
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
    <div ref={containerRef} onScroll={handleScroll} data-testid="message-list">
      {messages
        .filter((message) => message.text.trim() !== '')
        .map((message) => {
          const boardMove = message.text.match(BOARD_MOVE_PATTERN);
          if (boardMove) {
            const [, san, fen] = boardMove;
            return <MoveCard key={message.id} san={san ?? ''} fen={fen ?? ''} />;
          }
          const divider = decodePositionDivider(message.text);
          if (divider) {
            return <PositionDivider key={message.id} ply={divider.ply} san={divider.san} />;
          }
          return (
            <p key={message.id} data-role={message.role}>
              {message.text}
            </p>
          );
        })}
    </div>
  );
}
