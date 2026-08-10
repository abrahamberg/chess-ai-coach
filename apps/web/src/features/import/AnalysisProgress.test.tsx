import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('react-chessboard', () => ({
  Chessboard: () => <div data-testid="mock-chessboard" />
}));

const { AnalysisProgress } = await import('./AnalysisProgress.js');

const FINAL_FEN = 'rnb1k1nr/pppp1Qpp/8/2b1p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

describe('AnalysisProgress (design.md §4.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('shows the dimmed final position', () => {
    render(<AnalysisProgress status="queued" finalFen={FINAL_FEN} />);
    expect(screen.getByTestId('mock-chessboard')).toBeInTheDocument();
  });

  test('step 1 (Reading game) is current while queued or status is unknown', () => {
    render(<AnalysisProgress status={null} finalFen={FINAL_FEN} />);
    expect(screen.getByText('Reading game')).toHaveAttribute('aria-current', 'step');
  });

  test('step 2 (Engine review) is current while engine_running', () => {
    render(<AnalysisProgress status="engine_running" finalFen={FINAL_FEN} />);
    expect(screen.getByText('Engine review')).toHaveAttribute('aria-current', 'step');
  });

  test('step 3 (Coach preparing your session) is current while planning', () => {
    render(<AnalysisProgress status="planning" finalFen={FINAL_FEN} />);
    expect(screen.getByText('Coach preparing your session')).toHaveAttribute('aria-current', 'step');
  });

  test('shows a calm failure message with a retry action when analysis fails', () => {
    const onRetry = vi.fn();
    render(<AnalysisProgress status="failed" finalFen={FINAL_FEN} onRetry={onRetry} />);
    expect(screen.getByText(/couldn.t finish analyzing/i)).toBeInTheDocument();
    screen.getByRole('button', { name: /try again/i }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('shows how far the engine step has got, as a percentage of the game', () => {
    render(
      <AnalysisProgress status="engine_running" finalFen={FINAL_FEN} analyzedPositions={6} totalPositions={24} />
    );

    expect(screen.getByTestId('analysis-progress-percent')).toHaveTextContent('25%');
  });

  test('shows no percentage before the engine step, where there is nothing to count', () => {
    render(<AnalysisProgress status="queued" finalFen={FINAL_FEN} analyzedPositions={0} totalPositions={24} />);

    expect(screen.queryByTestId('analysis-progress-percent')).not.toBeInTheDocument();
  });

  // An unparseable PGN yields a total of 0; deriving a percentage from that
  // would divide by zero and render NaN%.
  test('shows no percentage when the total position count is unknown', () => {
    render(
      <AnalysisProgress status="engine_running" finalFen={FINAL_FEN} analyzedPositions={3} totalPositions={0} />
    );

    expect(screen.queryByTestId('analysis-progress-percent')).not.toBeInTheDocument();
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
