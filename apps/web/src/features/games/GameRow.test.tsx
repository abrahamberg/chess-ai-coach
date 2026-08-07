import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { GameRow } from './GameRow.js';

const BASE_GAME = {
  id: 'g1',
  source: 'paste' as const,
  userColor: 'white' as const,
  whiteName: 'daniel',
  blackName: 'Marta',
  result: '1-0',
  timeControl: '10+0',
  playedAt: '2026-07-20T10:00:00.000Z',
  createdAt: '2026-07-20T10:05:00.000Z',
  sessionId: null
};

describe('GameRow (design.md §4.1)', () => {
  test('shows both players with the user\'s side bold, and a win dot (design.md: dot, not raw score)', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'ready' }} onSelect={vi.fn()} />);

    expect(screen.getByText('daniel')).toBeInTheDocument();
    expect(screen.getByText('Marta')).toBeInTheDocument();
    expect(screen.getByTitle('win')).toBeInTheDocument();
  });

  test('shows an "analyzing…" chip while queued', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'queued' }} onSelect={vi.fn()} />);
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
  });

  test('shows a "ready — start session" chip when analysis is ready', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'ready' }} onSelect={vi.fn()} />);
    expect(screen.getByText(/ready.*start session/i)).toBeInTheDocument();
  });

  test('shows a "failed — retry" chip when analysis failed', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'failed' }} onSelect={vi.fn()} />);
    expect(screen.getByText(/failed.*retry/i)).toBeInTheDocument();
  });

  // architecture §14: a coach_play game never gets an `analyses` row, so it
  // must not fall into the analyze-mode "analyzing…" default forever.
  test('shows an "in progress — continue" chip for an unfinished play-mode game', () => {
    render(
      <GameRow
        game={{ ...BASE_GAME, source: 'coach_play', analysisStatus: null, sessionId: 'session-1' }}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText(/in progress.*continue/i)).toBeInTheDocument();
  });

  test('shows a "game over" chip for a play-mode game with no resumable session', () => {
    render(
      <GameRow game={{ ...BASE_GAME, source: 'coach_play', analysisStatus: null, sessionId: null }} onSelect={vi.fn()} />
    );
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
  });

  test('tapping the row calls onSelect with the game id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'ready' }} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /daniel.*marta/is }));
    expect(onSelect).toHaveBeenCalledWith('g1');
  });
});
