import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { SessionHeader } from './SessionHeader.js';

describe('SessionHeader (design.md §5.1/§5.2)', () => {
  test('shows the players and result', () => {
    render(<SessionHeader whiteName="daniel" blackName="Marta" result="1-0" onBack={vi.fn()} />);
    expect(screen.getByText(/daniel/)).toBeInTheDocument();
    expect(screen.getByText(/marta/i)).toBeInTheDocument();
    expect(screen.getByText('1-0')).toBeInTheDocument();
  });

  test('tapping back calls onBack', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<SessionHeader whiteName="daniel" blackName="Marta" result={null} onBack={onBack} />);

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
