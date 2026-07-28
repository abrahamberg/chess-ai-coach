import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ColorConfirm } from './ColorConfirm.js';

describe('ColorConfirm', () => {
  test('confirming white calls onConfirm with "white"', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ColorConfirm onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /white/i }));

    expect(onConfirm).toHaveBeenCalledWith('white');
  });

  test('confirming black calls onConfirm with "black"', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ColorConfirm onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /black/i }));

    expect(onConfirm).toHaveBeenCalledWith('black');
  });
});
