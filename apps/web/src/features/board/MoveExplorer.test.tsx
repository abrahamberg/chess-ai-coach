import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { MoveExplorer } from './MoveExplorer.js';

const SAN_MOVES = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];

function classifiedMove(overrides: Partial<ClassifiedMoveDto>): ClassifiedMoveDto {
  return {
    ply: 1,
    moveSan: 'e4',
    mover: 'white',
    isUserMove: true,
    cpLoss: 0,
    quality: 'good',
    bestLineSan: ['e4'],
    evalAfterCp: 20,
    ...overrides
  };
}

describe('MoveExplorer', () => {
  test('renders paired move numbers with White and Black SAN', () => {
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('e4')).toBeInTheDocument();
    expect(screen.getByText('e5')).toBeInTheDocument();
    expect(screen.getByText('4.')).toBeInTheDocument();
    expect(screen.getByText('Qxf7#')).toBeInTheDocument();
  });

  test('marks the current ply', () => {
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={3} onSelect={vi.fn()} />);

    expect(screen.getByText('Qh5')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('e5')).not.toHaveAttribute('aria-current');
  });

  test('clicking a move calls onSelect with its ply', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={0} onSelect={onSelect} />);

    await user.click(screen.getByText('Nc6'));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  test('renders a NAG symbol for a non-good move, but none for a good move', () => {
    const classifiedMoves = [
      classifiedMove({ ply: 3, moveSan: 'Qh5', quality: 'dubious' }),
      classifiedMove({ ply: 1, moveSan: 'e4', quality: 'good' })
    ];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '?!Qh5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'e4' })).toBeInTheDocument();
  });

  test('applies a quality-specific class per move for color coding', () => {
    const classifiedMoves = [
      classifiedMove({ ply: 7, moveSan: 'Qxf7#', quality: 'blunder' }),
      classifiedMove({ ply: 3, moveSan: 'Qh5', quality: 'brilliant' })
    ];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '??Qxf7#' })).toHaveClass('move-quality-blunder');
    expect(screen.getByRole('button', { name: '!!Qh5' })).toHaveClass('move-quality-brilliant');
  });

  test('nav pills step to first/prev/next/last move', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={3} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /previous move/i }));
    expect(onSelect).toHaveBeenLastCalledWith(2);

    await user.click(screen.getByRole('button', { name: /next move/i }));
    expect(onSelect).toHaveBeenLastCalledWith(4);

    await user.click(screen.getByRole('button', { name: /first move/i }));
    expect(onSelect).toHaveBeenLastCalledWith(0);

    await user.click(screen.getByRole('button', { name: /last move/i }));
    expect(onSelect).toHaveBeenLastCalledWith(7);
  });

  test('a "show notes" toggle reveals a plain-language note for the current non-good move, hidden by default', async () => {
    const user = userEvent.setup();
    const classifiedMoves = [classifiedMove({ ply: 3, moveSan: 'Qh5', quality: 'dubious', bestLineSan: ['Nf3'] })];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={3} onSelect={vi.fn()} />);

    expect(screen.queryByText(/better was nf3/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show notes/i }));

    expect(screen.getByText(/better was nf3/i)).toBeInTheDocument();
  });

  test('renders a star badge for a best move', () => {
    const classifiedMoves = [classifiedMove({ ply: 1, moveSan: 'e4', quality: 'best' })];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '★e4' })).toHaveClass('move-quality-best');
  });

  test('renders an X badge for a miss', () => {
    const classifiedMoves = [classifiedMove({ ply: 3, moveSan: 'Qh5', quality: 'miss' })];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '✕Qh5' })).toHaveClass('move-quality-miss');
  });

  test('the "show notes" panel does not show a "better was" note for a best move (nothing to improve on)', async () => {
    const user = userEvent.setup();
    const classifiedMoves = [classifiedMove({ ply: 1, moveSan: 'e4', quality: 'best', bestLineSan: ['e4'] })];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={1} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /show notes/i }));

    expect(screen.queryByText(/better was/i)).not.toBeInTheDocument();
  });
});
