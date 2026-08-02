import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { DivergedLineStart } from './DivergedLineStart.js';

describe('DivergedLineStart', () => {
  test('renders standard move-pair numbering and the SAN sequence for a coach-proposed hypothetical', () => {
    render(<DivergedLineStart basePly={25} sanMoves={['a3', 'f6']} />);

    expect(screen.getByText(/move 13 \(black\)/i)).toBeInTheDocument();
    expect(screen.getByText('13...a3 14.f6')).toBeInTheDocument();
  });
});
