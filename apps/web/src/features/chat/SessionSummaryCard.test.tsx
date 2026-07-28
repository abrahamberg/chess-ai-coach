import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { SessionSummaryCard } from './SessionSummaryCard.js';

describe('SessionSummaryCard', () => {
  test('shows the summary, homework, and both CTAs', async () => {
    const onBackToGames = vi.fn();
    const onViewProgress = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionSummaryCard
        summary="You worked on king safety today."
        homework="Solve 10 rook-endgame puzzles."
        onBackToGames={onBackToGames}
        onViewProgress={onViewProgress}
      />
    );

    expect(screen.getByText(/king safety/i)).toBeInTheDocument();
    expect(screen.getByText(/rook-endgame puzzles/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to games/i }));
    expect(onBackToGames).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: /view progress/i }));
    expect(onViewProgress).toHaveBeenCalledOnce();
  });

  test('omits the homework chip when there is none', () => {
    render(
      <SessionSummaryCard summary="Good session." homework={null} onBackToGames={vi.fn()} onViewProgress={vi.fn()} />
    );
    expect(screen.queryByText(/homework/i)).not.toBeInTheDocument();
  });
});
