import { useEffect, useState, type ReactNode } from 'react';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import type { AnalysisStatus } from '@chess-coach/shared';
import './AnalysisProgress.css';

export interface AnalysisProgressProps {
  status: AnalysisStatus | string | null;
  finalFen: string;
  onRetry?: () => void;
  /** Positions the engine has finished, from the status stream. */
  analyzedPositions?: number;
  /** The game's ply count, which the caller already knows from its own PGN.
   * Omit (or pass 0) and the engine step just shows no percentage. */
  totalPositions?: number;
}

const STEPS = ['Reading game', 'Engine review', 'Coach preparing your session'] as const;

/** Index of 'Engine review' in STEPS — the only step with countable work. */
const ENGINE_STEP = 1;

const STEP_FOR_STATUS: Record<string, number> = {
  queued: 0,
  engine_running: 1,
  planning: 2,
  ready: 2
};

const TIPS = [
  "The coach reviews every move, but you'll only talk about what matters.",
  'No engine numbers here — just the moments worth understanding.',
  'This usually takes under a minute.'
];

const TIP_ROTATE_MS = 4000;

/** design.md §4.2: shown between import submit and session ready. The final
 * position dims behind a 3-step progress driven by the analysis SSE status,
 * with rotating tips so the 30-90s wait feels attended, not stalled. */
export function AnalysisProgress({
  status,
  finalFen,
  onRetry,
  analyzedPositions = 0,
  totalPositions = 0
}: AnalysisProgressProps): ReactNode {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), TIP_ROTATE_MS);
    return () => clearInterval(interval);
  }, []);

  if (status === 'failed') {
    return (
      <div className="analysis-progress analysis-progress--failed">
        <p>That game couldn&rsquo;t finish analyzing. Nothing was lost — you can try again.</p>
        {onRetry && (
          <button type="button" className="btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const currentStep = status ? (STEP_FOR_STATUS[status] ?? 0) : 0;
  const options: ChessboardOptions = { position: finalFen, allowDragging: false };
  // Only the engine step has a measurable unit of work (positions). The other
  // two are single operations, so a percentage there would be invented.
  const enginePercent =
    totalPositions > 0 ? Math.min(100, Math.round((analyzedPositions / totalPositions) * 100)) : null;

  return (
    <div className="analysis-progress">
      <div className="analysis-progress__board">
        <Chessboard options={options} />
      </div>
      <ol className="analysis-progress__steps" aria-label="Analysis progress">
        {STEPS.map((step, index) => {
          const showPercent = index === ENGINE_STEP && index === currentStep && enginePercent !== null;
          return (
            <li key={step} aria-current={index === currentStep ? 'step' : undefined} data-done={index < currentStep}>
              {step}
              {showPercent && (
                <span className="analysis-progress__percent" data-testid="analysis-progress-percent">
                  {enginePercent}%
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="analysis-progress__tip" data-testid="analysis-progress-tip">
        {TIPS[tipIndex]}
      </p>
    </div>
  );
}
