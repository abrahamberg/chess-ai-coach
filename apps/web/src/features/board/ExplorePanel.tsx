import { useState, type ReactNode } from 'react';
import type { UseWasmEngineResult } from '../../hooks/useWasmEngine.js';
import './ExplorePanel.css';

export interface ExplorePanelProps {
  fen: string;
  onEnterPeekMode: () => void;
  engine: UseWasmEngineResult;
}

/** design.md §5.6: collapsed by default; expanding enters peek mode and runs
 * the in-browser engine. Word-based evals only — never a number, never sent
 * to the server. Presentational: the hook lives in SessionPage (AGENTS.md rule 7). */
export function ExplorePanel({ fen, onEnterPeekMode, engine }: ExplorePanelProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);

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
