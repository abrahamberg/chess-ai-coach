import type { ReactNode } from 'react';
import './SessionHeader.css';

export interface SessionHeaderProps {
  whiteName: string | null;
  blackName: string | null;
  result: string | null;
  onBack: () => void;
  onReset: () => void;
}

/** design.md §5.1/§5.2: the session's persistent game-context header — back
 * navigation + "White vs. Black  Result" — shown above the board (desktop)
 * or as the 40px top bar (mobile). Reset lets the student abandon the
 * ongoing session and start a fresh one over the same game (see
 * coach-agent's resetSession / POST /api/sessions/:id/reset). */
export function SessionHeader({ whiteName, blackName, result, onBack, onReset }: SessionHeaderProps): ReactNode {
  return (
    <header className="session-header">
      <button type="button" className="session-header__back" onClick={onBack} aria-label="Back to Games">
        ◀
      </button>
      <span className="session-header__players">
        {whiteName ?? '?'} vs. {blackName ?? '?'}
      </span>
      <span className="session-header__actions">
        {result && <span className="session-header__result">{result}</span>}
        <button type="button" className="session-header__reset" onClick={onReset}>
          Reset session
        </button>
      </span>
    </header>
  );
}
