import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { DivergedLineMessage } from './DivergedLineMessage.js';

describe('DivergedLineMessage', () => {
  test('shows the branch point, the SAN sequence, and the student comment', () => {
    render(<DivergedLineMessage basePly={25} sanText="13...a3 14.f6 a4" content="what if instead?" />);

    expect(screen.getByText(/move 13 \(black\)/i)).toBeInTheDocument();
    expect(screen.getByText('13...a3 14.f6 a4')).toBeInTheDocument();
    expect(screen.getByText('what if instead?')).toBeInTheDocument();
  });
});
