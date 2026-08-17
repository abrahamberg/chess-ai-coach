import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { CoachPersonaSelect } from './CoachPersonaSelect.js';

describe('CoachPersonaSelect', () => {
  test('renders all 7 personas, marking the current one', () => {
    render(<CoachPersonaSelect value="scholar" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /general daniel/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /the scholar/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /the gambler/i })).not.toBeChecked();
  });

  test('selecting a persona calls onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CoachPersonaSelect value="general" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /the gambler/i }));
    expect(onChange).toHaveBeenCalledWith('gambler');
  });

  test('marks the gambler and street shark personas explicit, and no others (coaches.md: profanity/insults are part of their character)', () => {
    render(<CoachPersonaSelect value="general" onChange={vi.fn()} />);

    expect(screen.getAllByTitle('Explicit language')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /the gambler/i }).closest('label')).toHaveTextContent('E');
    expect(screen.getByRole('radio', { name: /the street shark/i }).closest('label')).toHaveTextContent('E');
    expect(screen.getByRole('radio', { name: /the scholar/i }).closest('label')).not.toHaveTextContent('E');
  });
});
