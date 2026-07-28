import { useEffect, useState, type ReactNode } from 'react';
import type { UseWasmEngineResult } from '../../hooks/useWasmEngine.js';
import type { BoardMode } from '../session/useSessionBoardState.js';
import './ExplorePanel.css';

export interface ExplorePanelProps {
  fen: string;
  /** Leaving peek mode any other way (the peek pill's "back to coach", a new
   * coach show_position) must collapse this panel too — otherwise its
   * "isn't watching" caption is stuck on screen even once the coach is
   * watching again. */
  mode: BoardMode;
  onEnterPeekMode: () => void;
  engine: UseWasmEngineResult;
}

/** design.md §5.6: collapsed by default; expanding enters peek mode and runs
 * the in-browser engine. Word-based evals only — never a number, never sent
 * to the server. Presentational: the hook lives in SessionPage (AGENTS.md rule 7). */
export function ExplorePanel({ fen, mode, onEnterPeekMode, engine }: ExplorePanelProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (mode !== 'peek') setIsOpen(false);
  }, [mode]);

  if (!isOpen) {
    return (
      <button
        type="button"
        className="explore-panel-toggle"
        onClick={() => {
          setIsOpen(true);
          engine.analyze(fen);
          onEnterPeekMode();
        }}
      >
        Explore on your own
      </button>
    );
  }

  return (
    <div className="explore-panel">
      <p className="explore-panel-caption">your private exploration — the coach isn&apos;t watching</p>
      {engine.evaluation && <p className="explore-panel-eval">{engine.evaluation}</p>}
    </div>
  );
}
