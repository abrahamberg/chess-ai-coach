import { useEffect, useRef, useState, type ReactNode } from 'react';
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
 * or as the 40px top bar (mobile). Reset lives in the ⋯ menu rather than the
 * bar itself: it abandons the session (see coach-agent's resetSession /
 * POST /api/sessions/:id/reset), so it should never sit a stray tap away
 * from the actions the student actually reaches for. */
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
        <SessionMenu onReset={onReset} />
      </span>
    </header>
  );
}

function SessionMenu({ onReset }: { onReset: () => void }): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="session-header__menu" ref={menuRef}>
      <button
        type="button"
        className="session-header__more"
        aria-label="Session options"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        ⋯
      </button>
      {isOpen && (
        <div className="session-header__menu-items" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onReset();
            }}
          >
            Reset session
          </button>
        </div>
      )}
    </div>
  );
}
