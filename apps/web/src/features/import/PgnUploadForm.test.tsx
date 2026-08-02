import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { PgnUploadForm } from './PgnUploadForm.js';

describe('PgnUploadForm (design.md §4.2)', () => {
  test('reads the selected .pgn file and submits its text content', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PgnUploadForm onSubmit={onSubmit} />);

    const file = new File(['1. e4 e5 2. Nf3 *'], 'game.pgn', { type: 'application/x-chess-pgn' });
    const input = screen.getByLabelText(/pgn file/i);
    await user.upload(input, file);

    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ pgn: '1. e4 e5 2. Nf3 *', source: 'upload' })
    );
  });

  test('only accepts .pgn files', () => {
    render(<PgnUploadForm onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/pgn file/i)).toHaveAttribute('accept', '.pgn');
  });
});
