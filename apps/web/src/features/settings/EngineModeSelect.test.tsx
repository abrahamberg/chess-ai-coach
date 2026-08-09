import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { EngineModeSelect } from './EngineModeSelect.js';

describe('EngineModeSelect', () => {
  test('renders one radio per engine mode, checking the current value', () => {
    render(<EngineModeSelect value="native" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /server engine/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /your browser/i })).not.toBeChecked();
  });

  test('calls onChange with the selected mode', async () => {
    const onChange = vi.fn();
    render(<EngineModeSelect value="native" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: /your browser/i }));

    expect(onChange).toHaveBeenCalledWith('browser');
  });
});
