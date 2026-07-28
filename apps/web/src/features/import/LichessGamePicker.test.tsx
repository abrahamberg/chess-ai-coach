import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { LichessGamePicker } from './LichessGamePicker.js';

const GAMES = [
  {
    id: 'abcd1234',
    pgn: '1. e4 e5 1-0',
    whiteName: 'daniel',
    blackName: 'Marta',
    result: '1-0',
    timeControl: '600+0',
    playedAt: '2026-07-20T10:00:00.000Z'
  }
];

describe('LichessGamePicker', () => {
  test('renders a row per game (same format as the games list) and selecting it calls onSelect with its pgn', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<LichessGamePicker games={GAMES} isLoading={false} isLinked={true} onSelect={onSelect} />);

    expect(screen.getByText(/daniel/)).toBeInTheDocument();
    expect(screen.getByText(/marta/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /daniel.*marta/is }));
    expect(onSelect).toHaveBeenCalledWith(GAMES[0]!.pgn);
  });

  test('shows a link-account hint when the user has no linked Lichess username', () => {
    render(<LichessGamePicker games={[]} isLoading={false} isLinked={false} onSelect={vi.fn()} />);
    expect(screen.getByText(/link your lichess account/i)).toBeInTheDocument();
  });

  test('shows a loading state while fetching', () => {
    render(<LichessGamePicker games={[]} isLoading={true} isLinked={true} onSelect={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  test('shows an empty state when linked but no recent games', () => {
    render(<LichessGamePicker games={[]} isLoading={false} isLinked={true} onSelect={vi.fn()} />);
    expect(screen.getByText(/no recent games/i)).toBeInTheDocument();
  });
});
