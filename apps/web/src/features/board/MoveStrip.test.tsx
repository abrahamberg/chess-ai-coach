import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { MoveStrip } from './MoveStrip.js';

const SAN_MOVES = ['e4', 'e5', 'Nf3', 'Nc6'];

describe('MoveStrip', () => {
  test('renders move numbers and SAN, marking the current ply', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} currentPly={2} momentPlies={[]} onSelect={vi.fn()} />);

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    const current = screen.getByText('Nf3');
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('e5')).not.toHaveAttribute('aria-current');
  });

  test('marks moment plies with a dot', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} currentPly={0} momentPlies={[3]} onSelect={vi.fn()} />);
    expect(screen.getByText('Nc6')).toHaveClass('moment');
  });

  test('tapping a move calls onSelect with its ply', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MoveStrip sanMoves={SAN_MOVES} currentPly={0} momentPlies={[]} onSelect={onSelect} />);

    await user.click(screen.getByText('Nc6'));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});
