import { ENGINE_MODES, type EngineMode } from '@chess-coach/shared';
import type { ReactNode } from 'react';

export interface EngineModeSelectProps {
  value: EngineMode;
  onChange: (mode: EngineMode) => void;
}

const ENGINE_MODE_LABELS: Record<EngineMode, string> = {
  native: 'Server engine (default)',
  browser: 'Your browser (runs Stockfish locally — keep this tab open)'
};

/** design spec 2026-08-08 §9: lets a user opt into running the coach's
 * chess engine in their own browser tab instead of the server's. */
export function EngineModeSelect({ value, onChange }: EngineModeSelectProps): ReactNode {
  return (
    <div role="radiogroup" aria-label="Engine mode">
      {ENGINE_MODES.map((mode) => (
        <label key={mode}>
          <input type="radio" name="engine-mode" checked={value === mode} onChange={() => onChange(mode)} />
          {ENGINE_MODE_LABELS[mode]}
        </label>
      ))}
    </div>
  );
}
