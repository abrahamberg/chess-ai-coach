import { ENGINE_MODES, type EngineMode } from '@chess-coach/shared';
import type { ReactNode } from 'react';
import { useEngineStatus } from '../../hooks/useEngineStatus.js';
import './EngineModeSelect.css';

export interface EngineModeSelectProps {
  value: EngineMode;
  onChange: (mode: EngineMode) => void;
}

const ENGINE_MODE_LABELS: Record<EngineMode, string> = {
  native: 'Server engine (default)',
  browser: 'Your browser (runs Stockfish locally — keep this tab open)'
};

const ENGINE_STATUS_TEXT = {
  absent: 'Downloads the first time you analyze a game.',
  installing: 'Downloading engine… this happens once, then it stays on this device.',
  ready: 'Engine ready on this device.'
} as const;

/** design spec 2026-08-08 §9: lets a user opt into running the coach's
 * chess engine in their own browser tab instead of the server's.
 *
 * Browser mode also reports whether the engine is actually here yet. The
 * download is ~108MB, so "I picked browser mode and nothing seems to be
 * happening" is otherwise the normal first experience. Selecting browser mode
 * starts that download rather than deferring it to the first analysis, since
 * choosing it is the point at which the user expects the engine to arrive. */
export function EngineModeSelect({ value, onChange }: EngineModeSelectProps): ReactNode {
  const isBrowserMode = value === 'browser';
  const { status: engineStatus, progress } = useEngineStatus({ preload: isBrowserMode });
  const percent = progress ? Math.round(progress.percent * 100) : null;

  return (
    <div role="radiogroup" aria-label="Engine mode">
      {ENGINE_MODES.map((mode) => (
        <label key={mode}>
          <input type="radio" name="engine-mode" checked={value === mode} onChange={() => onChange(mode)} />
          {ENGINE_MODE_LABELS[mode]}
        </label>
      ))}
      {isBrowserMode && (
        <p className={`engine-status engine-status--${engineStatus}`} role="status">
          {engineStatus === 'installing' && <span className="engine-status__spinner" aria-hidden="true" />}
          {ENGINE_STATUS_TEXT[engineStatus]}
          {engineStatus === 'installing' && percent !== null && ` ${percent}%`}
          {engineStatus === 'installing' && progress?.speedText && ` · ${progress.speedText}`}
          {engineStatus === 'installing' && progress?.etaText && ` · ${progress.etaText} left`}
        </p>
      )}
      {engineStatus === 'installing' && percent !== null && (
        <progress className="engine-status__bar" value={percent} max={100} aria-label="Engine download progress" />
      )}
    </div>
  );
}
