import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CreditBalance } from './CreditBalance.js';

describe('CreditBalance', () => {
  test('shows the current balance', () => {
    render(<CreditBalance balance={42} />);
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });
});
