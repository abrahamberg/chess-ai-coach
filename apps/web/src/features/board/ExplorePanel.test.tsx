import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ExplorePanel } from './ExplorePanel.js';
import type { UseWasmEngineResult } from '../../hooks/useWasmEngine.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makeEngine(overrides: Partial<UseWasmEngineResult> = {}): UseWasmEngineResult {
  return { status: 'idle', evaluation: null, bestMoveArrow: null, analyze: vi.fn(), ...overrides };
}

describe('ExplorePanel', () => {
  test('collapsed by default, showing only the "Explore on your own" toggle', () => {
    render(<ExplorePanel fen={START_FEN} onEnterPeekMode={vi.fn()} engine={makeEngine()} />);

    expect(screen.getByRole('button', { name: /explore on your own/i })).toBeInTheDocument();
    expect(screen.queryByText(/private exploration/i)).not.toBeInTheDocument();
  });

  test('expanding calls analyze(fen), enters peek mode, and shows the private-exploration caption', async () => {
    const analyze = vi.fn();
    const onEnterPeekMode = vi.fn();
    const user = userEvent.setup();
    render(
      <ExplorePanel fen={START_FEN} onEnterPeekMode={onEnterPeekMode} engine={makeEngine({ analyze })} />
    );

    await user.click(screen.getByRole('button', { name: /explore on your own/i }));

    expect(analyze).toHaveBeenCalledWith(START_FEN);
    expect(onEnterPeekMode).toHaveBeenCalledOnce();
    expect(screen.getByText(/private exploration/i)).toBeInTheDocument();
  });

  test('renders the word-based evaluation once available, never a number', async () => {
    const user = userEvent.setup();
    render(
      <ExplorePanel
        fen={START_FEN}
        onEnterPeekMode={vi.fn()}
        engine={makeEngine({ status: 'ready', evaluation: 'White is better' })}
      />
    );

    await user.click(screen.getByRole('button', { name: /explore on your own/i }));

    expect(screen.getByText('White is better')).toBeInTheDocument();
  });
});
