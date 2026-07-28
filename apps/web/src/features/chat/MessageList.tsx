import { useEffect, useRef, type ReactNode } from 'react';
import type { CoachMessage } from '../../hooks/useCoachChat.js';

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
      {messages.map((message) => (
        <p key={message.id} data-role={message.role}>
          {message.text}
        </p>
      ))}
    </div>
  );
}
