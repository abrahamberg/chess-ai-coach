import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let lastSquareStyles: Record<string, unknown> = {};
let lastPosition: string | undefined;

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position?: string; squareStyles?: Record<string, unknown> } }) => {
    lastSquareStyles = options.squareStyles ?? {};
    lastPosition = options.position;
    return <div data-testid="mock-chessboard" />;
  }
}));

const { AnalysisProgress } = await import('./AnalysisProgress.js');

const FINAL_FEN = 'rnb1k1nr/pppp1Qpp/8/2b1p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const POSITIONS = [
  START_FEN,
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
  FINAL_FEN
];

describe('AnalysisProgress (design.md §4.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastSquareStyles = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('shows the dimmed final position', () => {
    render(<AnalysisProgress status="queued" finalFen={FINAL_FEN} />);
    expect(screen.getByTestId('mock-chessboard')).toBeInTheDocument();
  });

  test('highlights no squares yet while reading the game', () => {
    render(<AnalysisProgress status={null} finalFen={FINAL_FEN} />);
    expect(Object.keys(lastSquareStyles)).toHaveLength(0);
  });

  test('reports the phase to screen readers, not just visually', () => {
    render(<AnalysisProgress status="planning" finalFen={FINAL_FEN} />);
    expect(screen.getByRole('status')).toHaveTextContent(/preparing your coaching session/i);
  });

  test('shows a calm failure message with a retry action when analysis fails', () => {
    const onRetry = vi.fn();
    render(<AnalysisProgress status="failed" finalFen={FINAL_FEN} onRetry={onRetry} />);
    expect(screen.getByText(/couldn.t finish analyzing/i)).toBeInTheDocument();
    screen.getByRole('button', { name: /try again/i }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('lights up a quarter of the engine squares at 25% engine progress', () => {
    render(
      <AnalysisProgress status="engine_running" finalFen={FINAL_FEN} analyzedPositions={6} totalPositions={24} />
    );

    // 25% of the 56 engine squares (a1..h7), one of them left pulsing as "active".
    const lit = Object.entries(lastSquareStyles).filter(([, style]) => !hasAnimation(style));
    const active = Object.entries(lastSquareStyles).filter(([, style]) => hasAnimation(style));
    expect(lit).toHaveLength(13);
    expect(active).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('25%');
  });

  test('reports the engine phase to screen readers with no percent when the total is unknown', () => {
    render(
      <AnalysisProgress status="engine_running" finalFen={FINAL_FEN} analyzedPositions={3} totalPositions={0} />
    );

    expect(screen.getByRole('status')).toHaveTextContent(/reviewing your game/i);
    expect(screen.getByRole('status')).not.toHaveTextContent('%');
  });

  test('fills all 56 engine squares and animates the last rank once the engine finishes', () => {
    render(<AnalysisProgress status="planning" finalFen={FINAL_FEN} analyzedPositions={24} totalPositions={24} />);

    const animated = Object.entries(lastSquareStyles).filter(([, style]) => hasAnimation(style));
    const solid = Object.entries(lastSquareStyles).filter(([, style]) => !hasAnimation(style));
    expect(solid).toHaveLength(56);
    expect(animated).toHaveLength(8);
  });

  test('lights up all 64 squares once ready', () => {
    render(<AnalysisProgress status="ready" finalFen={FINAL_FEN} />);
    expect(Object.keys(lastSquareStyles)).toHaveLength(64);
  });

  // Regression: the board used to always show the game's final position, with
  // only the square-lighting animating -- so a long analysis looked static
  // and stalled even though positions were streaming in. Showing the actual
  // position currently being analyzed makes the wait visibly progress.
  test('shows the position currently being analyzed, not just the final one, while the engine runs', () => {
    render(
      <AnalysisProgress
        status="engine_running"
        finalFen={FINAL_FEN}
        positions={POSITIONS}
        analyzedPositions={2}
        totalPositions={POSITIONS.length}
      />
    );

    expect(lastPosition).toBe(POSITIONS[2]);
  });

  test('falls back to the final position when no positions array is given', () => {
    render(<AnalysisProgress status="engine_running" finalFen={FINAL_FEN} analyzedPositions={1} totalPositions={4} />);
    expect(lastPosition).toBe(FINAL_FEN);
  });

  test('shows the final position once analysis leaves the engine step, even with a positions array', () => {
    render(
      <AnalysisProgress
        status="planning"
        finalFen={FINAL_FEN}
        positions={POSITIONS}
        analyzedPositions={POSITIONS.length}
        totalPositions={POSITIONS.length}
      />
    );
    expect(lastPosition).toBe(FINAL_FEN);
  });

  test('mentions the wait can take a few minutes, not "under a minute"', () => {
    render(<AnalysisProgress status="queued" finalFen={FINAL_FEN} />);

    const seen = new Set<string | null>();
    for (let i = 0; i < 3; i++) {
      seen.add(screen.getByTestId('analysis-progress-tip').textContent);
      act(() => {
        vi.advanceTimersByTime(4000);
      });
    }

    expect([...seen].some((tip) => /a few minutes/i.test(tip ?? ''))).toBe(true);
    expect([...seen].some((tip) => /under a minute/i.test(tip ?? ''))).toBe(false);
  });

  test('rotates through short tips while waiting', () => {
    render(<AnalysisProgress status="queued" finalFen={FINAL_FEN} />);
    const first = screen.getByTestId('analysis-progress-tip').textContent;

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const second = screen.getByTestId('analysis-progress-tip').textContent;
    expect(second).not.toBe(first);
  });
});

function hasAnimation(style: unknown): boolean {
  return typeof style === 'object' && style !== null && 'animation' in style;
}
