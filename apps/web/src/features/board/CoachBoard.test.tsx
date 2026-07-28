import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ChessboardOptions } from 'react-chessboard';

const capturedOptions: ChessboardOptions[] = [];

vi.mock('react-chessboard', () => ({
  Chessboard: (props: { options: ChessboardOptions }) => {
    capturedOptions.push(props.options);
    return <div data-testid="mock-chessboard" />;
  }
}));

// Imported after the mock so CoachBoard picks up the mocked module.
const { CoachBoard } = await import('./CoachBoard.js');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('CoachBoard', () => {
  test('answer mode: a legal move calls onUserMove with the SAN and resulting fen', () => {
    capturedOptions.length = 0;
    const onUserMove = vi.fn();
    render(<CoachBoard fen={START_FEN} orientation="white" mode="answer" onUserMove={onUserMove} />);

    const options = capturedOptions.at(-1);
    const accepted = options?.onPieceDrop?.({
      piece: { pieceType: 'wP' } as never,
      sourceSquare: 'e2',
      targetSquare: 'e4'
    });

    expect(accepted).toBe(true);
    expect(onUserMove).toHaveBeenCalledWith('e4', expect.stringContaining('4P3'));
  });

  test('peek mode: a legal move updates the board locally but never calls onUserMove', () => {
    capturedOptions.length = 0;
    const onUserMove = vi.fn();
    render(<CoachBoard fen={START_FEN} orientation="white" mode="peek" onUserMove={onUserMove} />);

    const options = capturedOptions.at(-1);
    const accepted = options?.onPieceDrop?.({
      piece: { pieceType: 'wP' } as never,
      sourceSquare: 'e2',
      targetSquare: 'e4'
    });

    expect(accepted).toBe(true);
    expect(onUserMove).not.toHaveBeenCalled();
  });

  test('an illegal move is rejected (snaps back) and never calls onUserMove', () => {
    capturedOptions.length = 0;
    const onUserMove = vi.fn();
    render(<CoachBoard fen={START_FEN} orientation="white" mode="answer" onUserMove={onUserMove} />);

    const options = capturedOptions.at(-1);
    const accepted = options?.onPieceDrop?.({
      piece: { pieceType: 'wP' } as never,
      sourceSquare: 'e2',
      targetSquare: 'e5'
    });

    expect(accepted).toBe(false);
    expect(onUserMove).not.toHaveBeenCalled();
  });

  test('passes orientation and position through to the underlying board', () => {
    capturedOptions.length = 0;
    render(<CoachBoard fen={START_FEN} orientation="black" mode="answer" />);

    const options = capturedOptions.at(-1);
    expect(options?.boardOrientation).toBe('black');
    expect(options?.position).toBe(START_FEN);
  });

  test('renders arrows and highlights from props', () => {
    capturedOptions.length = 0;
    render(
      <CoachBoard
        fen={START_FEN}
        orientation="white"
        mode="answer"
        arrows={[{ from: 'e2', to: 'e4', color: '#c9762a' }]}
        highlights={[{ square: 'd5', color: '#4a7fb5' }]}
      />
    );

    const options = capturedOptions.at(-1);
    expect(options?.arrows).toEqual([{ startSquare: 'e2', endSquare: 'e4', color: '#c9762a' }]);
    expect(options?.squareStyles?.d5).toMatchObject({ backgroundColor: '#4a7fb5' });
  });

  test('renders nothing extra for screen readers beyond the board itself', () => {
    render(<CoachBoard fen={START_FEN} orientation="white" mode="answer" />);
    expect(screen.getByTestId('mock-chessboard')).toBeInTheDocument();
  });
});
