import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows both players with the user\'s side bold, and a win dot (design.md: dot, not raw score)', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'ready' }} onSelect={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText('daniel')).toBeInTheDocument();
    expect(screen.getByText('Marta')).toBeInTheDocument();
    expect(screen.getByTitle('win')).toBeInTheDocument();
  });

  test('shows an "analyzing…" chip while queued', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'queued' }} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
  });

  test('shows a "ready — start session" chip when analysis is ready', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'ready' }} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/ready.*start session/i)).toBeInTheDocument();
  });

  // Plain "failed", not "failed — retry": clicking the row no-ops for a
  // failed game (handleSelect gates on analysisStatus === 'ready'), so a
  // label promising a retry that doesn't exist is worse than no label.
  test('shows a "failed" chip when analysis failed', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'failed' }} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  // architecture §14: a coach_play game never gets an `analyses` row, so it
  // must not fall into the analyze-mode "analyzing…" default forever.
  test('shows an "in progress — continue" chip for an unfinished play-mode game', () => {
    render(
      <GameRow
        game={{ ...BASE_GAME, source: 'coach_play', analysisStatus: null, sessionId: 'session-1' }}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/in progress.*continue/i)).toBeInTheDocument();
  });

  test('shows a "game over" chip for a play-mode game with no resumable session', () => {
    render(
      <GameRow
        game={{ ...BASE_GAME, source: 'coach_play', analysisStatus: null, sessionId: null }}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
  });

  test('tapping the row calls onSelect with the game id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'ready' }} onSelect={onSelect} onDelete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /daniel.*marta/is }));
    expect(onSelect).toHaveBeenCalledWith('g1');
  });

  test('shows a "Delete failed game" button for a game that failed to analyse', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'failed' }} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /delete failed game/i })).toBeInTheDocument();
  });

  test('shows a plain "Delete" button for a game that is not failed', () => {
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'ready' }} onSelect={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  test('clicking delete confirms, then calls onDelete with the game id without selecting the row', async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'failed' }} onSelect={onSelect} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: /delete failed game/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith('g1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('clicking delete does nothing if the confirm dialog is declined', async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<GameRow game={{ ...BASE_GAME, analysisStatus: 'ready' }} onSelect={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(onDelete).not.toHaveBeenCalled();
  });
});
