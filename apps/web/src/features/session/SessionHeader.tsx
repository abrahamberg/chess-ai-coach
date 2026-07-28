import type { ReactNode } from 'react';
import './SessionHeader.css';

export interface SessionHeaderProps {
  whiteName: string | null;
  blackName: string | null;
  result: string | null;
  onBack: () => void;
}

/** design.md §5.1/§5.2: the session's persistent game-context header — back
 * navigation + "White vs. Black  Result" — shown above the board (desktop)
 * or as the 40px top bar (mobile). */
export function SessionHeader({ whiteName, blackName, result, onBack }: SessionHeaderProps): ReactNode {
  return (
    <header className="session-header">
      <button type="button" className="session-header__back" onClick={onBack} aria-label="Back to Games">
        ◀
      </button>
      <span className="session-header__players">
        {whiteName ?? '?'} vs. {blackName ?? '?'}
      </span>
      {result && <span className="session-header__result">{result}</span>}
    </header>
  );
}
