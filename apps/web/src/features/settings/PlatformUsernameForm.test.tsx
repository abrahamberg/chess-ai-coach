import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { PlatformUsernameForm } from './PlatformUsernameForm.js';

describe('PlatformUsernameForm', () => {
  test('a null value renders an empty, unset input with no Edit/Delete buttons', () => {
    render(<PlatformUsernameForm platform="lichess" label="Lichess username" value={null} onSave={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: /lichess username/i })).toHaveValue('');
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  test('typing a username and saving calls onSave (add)', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<PlatformUsernameForm platform="lichess" label="Lichess username" value={null} onSave={onSave} onDelete={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: /lichess username/i }), 'my_handle');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('my_handle');
  });

  test('a set value shows it read-only with Edit/Delete, not an input', () => {
    render(
      <PlatformUsernameForm platform="chesscom" label="Chess.com username" value="old_name" onSave={vi.fn()} onDelete={vi.fn()} />
    );

    expect(screen.getByText(/old_name/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  test('Edit reveals an input pre-filled with the current value; saving calls onSave with the new value', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<PlatformUsernameForm platform="lichess" label="Lichess username" value="old_name" onSave={onSave} onDelete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const input = screen.getByRole('textbox', { name: /lichess username/i });
    expect(input).toHaveValue('old_name');

    await user.clear(input);
    await user.type(input, 'new_name');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith('new_name');
  });

  test('Delete calls onDelete directly, without entering edit mode', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<PlatformUsernameForm platform="lichess" label="Lichess username" value="old_name" onSave={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(onDelete).toHaveBeenCalledOnce();
  });

  test('Delete clearing the value to null resets the leftover draft text — the add form starts empty, not showing the deleted username', () => {
    const { rerender } = render(
      <PlatformUsernameForm platform="lichess" label="Lichess username" value="old_name" onSave={vi.fn()} onDelete={vi.fn()} />
    );

    // Simulates what happens after a successful Delete: the parent refetches
    // and passes value=null down to this same, still-mounted component instance.
    rerender(<PlatformUsernameForm platform="lichess" label="Lichess username" value={null} onSave={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: /lichess username/i })).toHaveValue('');
  });

  test('Cancel from Edit mode returns to the read-only view without saving', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<PlatformUsernameForm platform="lichess" label="Lichess username" value="old_name" onSave={onSave} onDelete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/old_name/)).toBeInTheDocument();
  });
});
