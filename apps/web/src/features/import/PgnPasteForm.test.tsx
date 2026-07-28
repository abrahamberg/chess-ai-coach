import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ImportGameRequestSchema } from '@chess-coach/shared';
import { PgnPasteForm } from './PgnPasteForm.js';

describe('PgnPasteForm', () => {
  test('submits a body that validates against ImportGameRequestSchema', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PgnPasteForm onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: /pgn/i }), '1. e4 e5 2. Nf3 Nc6');
    await user.click(screen.getByRole('button', { name: /import/i }));

    expect(onSubmit).toHaveBeenCalledOnce();
    const body = onSubmit.mock.calls[0]?.[0];
    expect(ImportGameRequestSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ pgn: '1. e4 e5 2. Nf3 Nc6', source: 'paste' });
  });

  test('does not submit an empty pgn', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PgnPasteForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /import/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
