import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { PositionDivider } from './PositionDivider.js';

describe('PositionDivider', () => {
  test('renders the standard chess move number/color, not the raw ply', () => {
    // ply 35 is White's 18th move (ceil(35/2)) — not "move 35".
    render(<PositionDivider ply={35} san="bxc3" />);
    expect(screen.getByText(/move 18/i)).toBeInTheDocument();
    expect(screen.getByText(/white/i)).toBeInTheDocument();
    expect(screen.queryByText(/move 35/i)).not.toBeInTheDocument();
    expect(screen.getByText(/bxc3/)).toBeInTheDocument();
  });

  test('renders black moves correctly', () => {
    render(<PositionDivider ply={14} san="Bg4" />);
    expect(screen.getByText(/move 7/i)).toBeInTheDocument();
    expect(screen.getByText(/black/i)).toBeInTheDocument();
  });

  test('clicking it jumps the board to that ply via onSelect', () => {
    const onSelect = vi.fn();
    render(<PositionDivider ply={14} san="Bg4" onSelect={onSelect} />);

    screen.getByRole('button').click();

    expect(onSelect).toHaveBeenCalledWith(14);
  });
});
