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
    const onLocalMove = vi.fn();
    render(<CoachBoard fen={START_FEN} orientation="white" mode="peek" onUserMove={onUserMove} onLocalMove={onLocalMove} />);

    const options = capturedOptions.at(-1);
    const accepted = options?.onPieceDrop?.({
      piece: { pieceType: 'wP' } as never,
      sourceSquare: 'e2',
      targetSquare: 'e4'
    });

    expect(accepted).toBe(true);
    expect(onUserMove).not.toHaveBeenCalled();
    expect(onLocalMove).toHaveBeenCalledWith(expect.stringContaining('4P3'));
  });

  test('answer mode: a legal move also fires onLocalMove, so the drop is reflected immediately', () => {
    capturedOptions.length = 0;
    const onLocalMove = vi.fn();
    render(<CoachBoard fen={START_FEN} orientation="white" mode="answer" onLocalMove={onLocalMove} />);

    const options = capturedOptions.at(-1);
    options?.onPieceDrop?.({
      piece: { pieceType: 'wP' } as never,
      sourceSquare: 'e2',
      targetSquare: 'e4'
    });

    expect(onLocalMove).toHaveBeenCalledWith(expect.stringContaining('4P3'));
  });

  test('an illegal move never fires onLocalMove', () => {
    capturedOptions.length = 0;
    const onLocalMove = vi.fn();
    render(<CoachBoard fen={START_FEN} orientation="white" mode="answer" onLocalMove={onLocalMove} />);

    const options = capturedOptions.at(-1);
    options?.onPieceDrop?.({
      piece: { pieceType: 'wP' } as never,
      sourceSquare: 'e2',
      targetSquare: 'e5'
    });

    expect(onLocalMove).not.toHaveBeenCalled();
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

  test('castling fires onLocalMove with a fen reflecting both the king and the rook moving', () => {
    capturedOptions.length = 0;
    const onLocalMove = vi.fn();
    const CASTLE_READY_FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    render(<CoachBoard fen={CASTLE_READY_FEN} orientation="white" mode="answer" onLocalMove={onLocalMove} />);

    const options = capturedOptions.at(-1);
    const accepted = options?.onPieceDrop?.({
      piece: { pieceType: 'wK' } as never,
      sourceSquare: 'e1',
      targetSquare: 'g1'
    });

    expect(accepted).toBe(true);
    // rook jumps from h1 to f1 as part of the same move — onLocalMove's fen
    // must show that too, not just the king's destination.
    expect(onLocalMove).toHaveBeenCalledWith(expect.stringContaining('RNBQ1RK1'));
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

  test('design.md §5.4: peek mode tints the board frame', () => {
    render(<CoachBoard fen={START_FEN} orientation="white" mode="peek" />);
    expect(screen.getByTestId('mock-chessboard').parentElement).toHaveClass('coach-board-frame--peek');
  });

  test('renders nothing extra for screen readers beyond the board itself', () => {
    render(<CoachBoard fen={START_FEN} orientation="white" mode="answer" />);
    expect(screen.getByTestId('mock-chessboard')).toBeInTheDocument();
  });

  test('allows drawing arrows and reports the student-drawn set through onArrowsChange, distinct from the coach-controlled arrows prop', () => {
    capturedOptions.length = 0;
    const onArrowsChange = vi.fn();
    render(
      <CoachBoard
        fen={START_FEN}
        orientation="white"
        mode="answer"
        arrows={[{ from: 'e2', to: 'e4', color: '#c9762a' }]}
        onArrowsChange={onArrowsChange}
      />
    );

    const options = capturedOptions.at(-1);
    expect(options?.allowDrawingArrows).toBe(true);
    options?.onArrowsChange?.({ arrows: [{ startSquare: 'g8', endSquare: 'f6', color: 'green' }] });

    expect(onArrowsChange).toHaveBeenCalledWith([{ from: 'g8', to: 'f6', color: 'green' }]);
  });

  test('clears drawn arrows automatically when the position changes (design.md §5.4-style auto-clear)', () => {
    capturedOptions.length = 0;
    render(<CoachBoard fen={START_FEN} orientation="white" mode="answer" />);
    expect(capturedOptions.at(-1)?.clearArrowsOnPositionChange).toBe(true);
  });
});
