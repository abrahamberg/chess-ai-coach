import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { TrendChart } from './TrendChart.js';

const TRENDS = [
  { category: 'king_safety' as const, last5: 1, last20: 4 },
  { category: 'passive_play' as const, last5: 0, last20: 2 }
];

describe('TrendChart', () => {
  test('renders one bar per category, sized by the selected range', () => {
    render(<TrendChart trends={TRENDS} range="last20" onRangeChange={vi.fn()} onBarClick={vi.fn()} />);

    const kingSafetyBar = screen.getByRole('button', { name: /king safety.*4/i });
    expect(kingSafetyBar).toBeInTheDocument();
    const passiveBar = screen.getByRole('button', { name: /passive play.*2/i });
    expect(passiveBar).toBeInTheDocument();
  });

  test('switches the displayed count when range changes', () => {
    render(<TrendChart trends={TRENDS} range="last5" onRangeChange={vi.fn()} onBarClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /king safety.*1/i })).toBeInTheDocument();
  });

  test('toggling last 5 / last 20 calls onRangeChange', async () => {
    const onRangeChange = vi.fn();
    const user = userEvent.setup();
    render(<TrendChart trends={TRENDS} range="last20" onRangeChange={onRangeChange} onBarClick={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /last 5/i }));
    expect(onRangeChange).toHaveBeenCalledWith('last5');
  });

  test('tapping a bar calls onBarClick with the category', async () => {
    const onBarClick = vi.fn();
    const user = userEvent.setup();
    render(<TrendChart trends={TRENDS} range="last20" onRangeChange={vi.fn()} onBarClick={onBarClick} />);

    await user.click(screen.getByRole('button', { name: /king safety.*4/i }));
    expect(onBarClick).toHaveBeenCalledWith('king_safety');
  });

  test('shows an empty state with no trends', () => {
    render(<TrendChart trends={[]} range="last20" onRangeChange={vi.fn()} onBarClick={vi.fn()} />);
    expect(screen.getByText(/no mistakes recorded yet/i)).toBeInTheDocument();
  });
});
