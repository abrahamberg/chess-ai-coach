import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { PositionDivider } from './PositionDivider.js';

describe('PositionDivider', () => {
  test('renders the ply and the move that led to it', () => {
    render(<PositionDivider ply={14} san="Bg4" />);
    expect(screen.getByText(/move 14/i)).toBeInTheDocument();
    expect(screen.getByText(/Bg4/)).toBeInTheDocument();
  });
});
