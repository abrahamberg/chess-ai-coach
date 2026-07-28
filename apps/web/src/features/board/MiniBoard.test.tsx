import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { ChessboardOptions } from 'react-chessboard';

const capturedOptions: ChessboardOptions[] = [];

vi.mock('react-chessboard', () => ({
  Chessboard: (props: { options: ChessboardOptions }) => {
    capturedOptions.push(props.options);
    return <div data-testid="mock-chessboard" />;
  }
}));

const { MiniBoard } = await import('./MiniBoard.js');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('MiniBoard', () => {
  test('renders a non-interactive thumbnail at the requested size', () => {
    capturedOptions.length = 0;
    render(<MiniBoard fen={START_FEN} size={96} onExpand={vi.fn()} />);

    const options = capturedOptions.at(-1);
    expect(options?.position).toBe(START_FEN);
    expect(options?.allowDragging).toBe(false);
    expect(screen.getByRole('button', { name: /expand board/i })).toHaveStyle({ width: '96px', height: '96px' });
  });

  test('calls onExpand when tapped', async () => {
    const onExpand = vi.fn();
    const user = userEvent.setup();
    render(<MiniBoard fen={START_FEN} size={96} onExpand={onExpand} />);

    await user.click(screen.getByRole('button', { name: /expand board/i }));
    expect(onExpand).toHaveBeenCalledOnce();
  });
});
