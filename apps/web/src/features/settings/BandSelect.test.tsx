import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { BandSelect } from './BandSelect.js';

describe('BandSelect', () => {
  test('renders all 4 bands in plain language, marking the current one', () => {
    render(<BandSelect value="club" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /new to chess/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /club/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /advanced/i })).not.toBeChecked();
  });

  test('selecting a band calls onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BandSelect value="novice" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /advanced/i }));
    expect(onChange).toHaveBeenCalledWith('advanced');
  });
});
