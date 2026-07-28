import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { PositionContextMessage } from './PositionContextMessage.js';

describe('PositionContextMessage', () => {
  test('shows which position the student was anchored to, plus their message', () => {
    render(<PositionContextMessage moveNumber={9} color="black" san="bxc3" content="what should I look at here?" />);

    expect(screen.getByText(/move 9 \(black\)/i)).toBeInTheDocument();
    expect(screen.getByText(/bxc3/)).toBeInTheDocument();
    expect(screen.getByText('what should I look at here?')).toBeInTheDocument();
  });
});
