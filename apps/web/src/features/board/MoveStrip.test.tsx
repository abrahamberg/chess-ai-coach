import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { MoveStrip } from './MoveStrip.js';

const SAN_MOVES = ['e4', 'e5', 'Nf3', 'Nc6'];

describe('MoveStrip', () => {
  test('renders move numbers and SAN, marking the current ply', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={2} momentPlies={[]} onSelect={vi.fn()} />);

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    const current = screen.getByText('Nf3');
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('e5')).not.toHaveAttribute('aria-current');
  });

  test('marks moment plies with a dot', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={0} momentPlies={[3]} onSelect={vi.fn()} />);
    expect(screen.getByText('Nc6')).toHaveClass('moment');
  });

  test('tapping a move calls onSelect with its ply', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={0} momentPlies={[]} onSelect={onSelect} />);

    await user.click(screen.getByText('Nc6'));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  test('renders a quality badge on the chip matching ClassifiedMoveDto.ply (1-based), not the local 0-based index', () => {
    const classifiedMoves = [
      {
        ply: 3,
        moveSan: 'Nf3',
        mover: 'white' as const,
        isUserMove: false,
        cpLoss: 400,
        quality: 'blunder' as const,
        bestLineSan: ['Nc3'],
        evalAfterCp: -400,
        hangsPiece: false
      }
    ];
    render(
      <MoveStrip sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} momentPlies={[]} onSelect={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: /nf3/i })).toHaveClass('move-quality-blunder');
    expect(screen.getByRole('button', { name: /nc6/i }).className).not.toMatch(/move-quality-/);
  });

  test('renders no quality class for a chip with no matching classified move', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={0} momentPlies={[]} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'e4' }).className).not.toMatch(/move-quality-/);
  });
});
