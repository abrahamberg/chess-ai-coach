import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
   * Omit (or pass 0) and the engine step just shows no measurable progress. */
  totalPositions?: number;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** a1, b1, ... h1, a2, ... h8 — bottom-left to top-right, the same order the
 * squares fill in. */
const SQUARES = Array.from({ length: 64 }, (_, i) => `${FILES[i % 8]}${Math.floor(i / 8) + 1}`);

/** Ranks 1-7 track the engine's measurable progress (positions analyzed).
 * Rank 8 stands in for the coach's prep pass, which has no countable unit of
 * work, so it fills as an indeterminate wave instead of a real count.
 * "Reading game" isn't represented at all — it's instant, nothing to show. */
const ENGINE_SQUARES = 56;
const TOTAL_SQUARES = 64;

const TIPS = [
  "The coach reviews every move, but you'll only talk about what matters.",
  'No engine numbers here — just the moments worth understanding.',
  'This usually takes under a minute.'
];

const TIP_ROTATE_MS = 4000;

type CellState = 'dim' | 'lit' | 'active' | 'wave';

/** One state per square, in fill order. `active` marks the square currently
 * being worked on (a soft pulse); `wave` marks squares whose progress can't
 * be counted, so they animate instead of claiming a number. */
function cellStates(status: AnalysisProgressProps['status'], enginePercent: number | null): CellState[] {
  const states: CellState[] = new Array(TOTAL_SQUARES).fill('dim');

  if (status === 'ready') return states.fill('lit');

  if (status === 'planning') {
    states.fill('lit', 0, ENGINE_SQUARES);
    states.fill('wave', ENGINE_SQUARES, TOTAL_SQUARES);
    return states;
  }

  if (status === 'engine_running') {
    if (enginePercent === null) return states.fill('wave', 0, ENGINE_SQUARES);
    const lit = Math.round((enginePercent / 100) * ENGINE_SQUARES);
    states.fill('lit', 0, lit);
    if (lit > 0 && lit < ENGINE_SQUARES) states[lit - 1] = 'active';
    return states;
  }

  return states; // queued, or status not yet known
}

function styleForActiveSquare(): CSSProperties {
  return { backgroundColor: 'var(--accent)', animation: 'analysis-progress-pulse 1s ease-in-out infinite' };
}

function styleForWaveSquare(waveIndex: number): CSSProperties {
  return {
    backgroundColor: 'var(--last-move)',
    animation: `analysis-progress-wave 1.8s ease-in-out ${waveIndex * 70}ms infinite`
  };
}

/** Maps cell states onto react-chessboard's squareStyles — the same
 * mechanism CoachBoard uses for move highlights (see BoardHighlight). */
function buildSquareStyles(states: CellState[]): Record<string, CSSProperties> {
  const styles: Record<string, CSSProperties> = {};
  let waveIndex = 0;
  for (const [i, state] of states.entries()) {
    if (state === 'dim') continue;
    if (state === 'lit') styles[SQUARES[i]!] = { backgroundColor: 'var(--last-move)' };
    if (state === 'active') styles[SQUARES[i]!] = styleForActiveSquare();
    if (state === 'wave') styles[SQUARES[i]!] = styleForWaveSquare(waveIndex++);
  }
  return styles;
}

/** For screen readers — the squares filling in is a purely visual cue. */
function describeProgress(status: AnalysisProgressProps['status'], enginePercent: number | null): string {
  if (status === 'engine_running') {
    return enginePercent !== null ? `Reviewing your game — ${enginePercent}%` : 'Reviewing your game';
  }
  if (status === 'planning') return 'Preparing your coaching session';
  if (status === 'ready') return 'Analysis ready';
  return 'Reading your game';
}

/** design.md §4.2: shown between import submit and session ready. The final
 * position's squares fill in bottom-left to top-right as analysis progresses
 * (engine review counted exactly, coach prep as an indeterminate wave), with
 * rotating tips so the 30-90s wait feels attended, not stalled. */
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

  // Only the engine step has a measurable unit of work (positions).
  const enginePercent =
    totalPositions > 0 ? Math.min(100, Math.round((analyzedPositions / totalPositions) * 100)) : null;
  const options: ChessboardOptions = {
    position: finalFen,
    allowDragging: false,
    squareStyles: buildSquareStyles(cellStates(status, enginePercent))
  };

  return (
    <div className="analysis-progress">
      <div className="analysis-progress__board">
        <Chessboard options={options} />
      </div>
      <p className="visually-hidden" role="status">
        {describeProgress(status, enginePercent)}
      </p>
      <p className="analysis-progress__tip" data-testid="analysis-progress-tip">
        {TIPS[tipIndex]}
      </p>
    </div>
  );
}
