import type { ReactNode } from 'react';
import { describePly } from './positionDivider.js';

export interface DivergedLineMessageProps {
  basePly: number;
  sanText: string;
  content: string;
}

/** The student's submitted diverged line + optional commentary, rendered in
 * their chat bubble — "↳ exploring from move 13 (black): 13...a3 14.f6 a4"
 * followed by whatever they typed — mirrors PositionContextMessage's role
 * for a peeked-position message. */
export function DivergedLineMessage({ basePly, sanText, content }: DivergedLineMessageProps): ReactNode {
  const { moveNumber, color } = describePly(basePly + 1);
  return (
    <p data-role="user" className="diverged-line-message">
      <span className="diverged-line-message__note">
        ↳ exploring from move {moveNumber} ({color}): <code className="san">{sanText}</code>
      </span>
      {content}
    </p>
  );
}
