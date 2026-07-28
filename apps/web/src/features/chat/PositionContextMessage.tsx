import type { ReactNode } from 'react';

export interface PositionContextMessageProps {
  moveNumber: number;
  color: 'white' | 'black';
  san: string;
  content: string;
}

/** A student message sent while peeked away from the coach's position (e.g.
 * after clicking a PositionDivider) — a small "back to move N" note above the
 * bubble so the transcript still reads coherently, mirroring PositionDivider's
 * role for show_position jumps. */
export function PositionContextMessage({ moveNumber, color, san, content }: PositionContextMessageProps): ReactNode {
  return (
    <p data-role="user" className="position-context-message">
      <span className="position-context-message__note">
        ↩ back to move {moveNumber} ({color}), after <code className="san">{san}</code>
      </span>
      {content}
    </p>
  );
}
