import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { SessionHistory } from './SessionHistory.js';

const SESSIONS = [
  {
    sessionId: 's1',
    gameId: 'g1',
    startedAt: '2026-07-20T10:00:00.000Z',
    whiteName: 'daniel',
    blackName: 'Marta',
    userColor: 'white' as const,
    result: '1-0',
    summary: 'Worked on king safety today.',
    homework: 'Solve 10 rook-endgame puzzles.'
  },
  {
    sessionId: 's2',
    gameId: 'g2',
    startedAt: '2026-07-18T10:00:00.000Z',
    whiteName: 'Bob',
    blackName: 'daniel',
    userColor: 'black' as const,
    result: '0-1',
    summary: 'Good calculation in the endgame.',
    homework: null
  }
];

describe('SessionHistory', () => {
  test('lists each session with the game, one-line summary, and a homework chip when assigned', () => {
    render(<SessionHistory sessions={SESSIONS} onSelect={vi.fn()} />);

    expect(screen.getAllByText(/daniel/)).toHaveLength(2);
    expect(screen.getByText(/worked on king safety today/i)).toBeInTheDocument();
    expect(screen.getByText(/solve 10 rook-endgame puzzles/i)).toBeInTheDocument();
    expect(screen.getByText(/good calculation in the endgame/i)).toBeInTheDocument();
  });

  test('tapping a row calls onSelect with the session id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SessionHistory sessions={SESSIONS} onSelect={onSelect} />);

    await user.click(screen.getByText(/worked on king safety today/i));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  test('shows an empty state with no sessions', () => {
    render(<SessionHistory sessions={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument();
  });
});
