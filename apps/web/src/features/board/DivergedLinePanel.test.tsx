import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { DivergedLinePanel } from './DivergedLinePanel.js';

const LINE = { basePly: 25, moves: [{ san: 'a3' }, { san: 'f6' }, { san: 'a4' }] };

describe('DivergedLinePanel', () => {
  test('renders the branch point and the move list paired from basePly', () => {
    render(
      <DivergedLinePanel
        line={LINE}
        stepIndex={3}
        onSelectStep={vi.fn()}
        onExit={vi.fn()}
        autoplayIntervalMs={1000}
        onChangeAutoplayInterval={vi.fn()}
      />
    );

    expect(screen.getByText(/move 13 \(black\)/i)).toBeInTheDocument();
    expect(screen.getByText('13.')).toBeInTheDocument();
    expect(screen.getByText('14.')).toBeInTheDocument();
    expect(screen.getByText('a3')).toBeInTheDocument();
    expect(screen.getByText('f6')).toBeInTheDocument();
    expect(screen.getByText('a4')).toBeInTheDocument();
  });

  test('marks the current step', () => {
    render(
      <DivergedLinePanel
        line={LINE}
        stepIndex={2}
        onSelectStep={vi.fn()}
        onExit={vi.fn()}
        autoplayIntervalMs={1000}
        onChangeAutoplayInterval={vi.fn()}
      />
    );

    expect(screen.getByText('f6')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('a3')).not.toHaveAttribute('aria-current');
  });

  test('clicking a move step calls onSelectStep with its step index', async () => {
    const onSelectStep = vi.fn();
    const user = userEvent.setup();
    render(
      <DivergedLinePanel
        line={LINE}
        stepIndex={0}
        onSelectStep={onSelectStep}
        onExit={vi.fn()}
        autoplayIntervalMs={1000}
        onChangeAutoplayInterval={vi.fn()}
      />
    );

    await user.click(screen.getByText('f6'));
    expect(onSelectStep).toHaveBeenCalledWith(2);
  });

  test('clicking the exit button calls onExit', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(
      <DivergedLinePanel
        line={LINE}
        stepIndex={0}
        onSelectStep={vi.fn()}
        onExit={onExit}
        autoplayIntervalMs={1000}
        onChangeAutoplayInterval={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /back to game/i }));
    expect(onExit).toHaveBeenCalled();
  });
});
