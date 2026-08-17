import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { NicknameForm } from './NicknameForm.js';

describe('NicknameForm', () => {
  test('shows the current nickname with an Edit button, no input, by default', () => {
    render(<NicknameForm value="Daniel" onSave={vi.fn()} />);

    expect(screen.getByText(/daniel/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('clicking Edit reveals an input pre-filled with the current value; saving calls onSave and exits edit mode', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<NicknameForm value="Daniel" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const input = screen.getByRole('textbox', { name: /nickname/i });
    expect(input).toHaveValue('Daniel');

    await user.clear(input);
    await user.type(input, 'Dani');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('Dani');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  test('Cancel discards the edit without calling onSave', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<NicknameForm value="Daniel" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.type(screen.getByRole('textbox', { name: /nickname/i }), 'x');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/daniel/i)).toBeInTheDocument();
  });

  test('does not save a blank nickname', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<NicknameForm value="Daniel" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.clear(screen.getByRole('textbox', { name: /nickname/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).not.toHaveBeenCalled();
  });
});
