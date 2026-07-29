import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ArrowChip } from './ArrowChip.js';

describe('ArrowChip', () => {
  test('shows the from/to squares', () => {
    render(<ArrowChip from="e2" to="e4" onRemove={vi.fn()} />);
    expect(screen.getByText('e2')).toBeInTheDocument();
    expect(screen.getByText('e4')).toBeInTheDocument();
  });

  test('is draggable, so it can be reordered within the reply text', () => {
    render(<ArrowChip from="e2" to="e4" onRemove={vi.fn()} />);
    expect(screen.getByTestId('arrow-chip')).toHaveAttribute('draggable', 'true');
  });

  test('clicking the remove button calls onRemove, not onSelectPly-style navigation', () => {
    const onRemove = vi.fn();
    render(<ArrowChip from="e2" to="e4" onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledOnce();
  });

  test('dragstart puts the chip id on the dataTransfer for the composer to read on drop', () => {
    render(<ArrowChip id="chip-1" from="e2" to="e4" onRemove={vi.fn()} />);
    const chip = screen.getByTestId('arrow-chip');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };

    fireEvent.dragStart(chip, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'chip-1');
  });
});
