import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getSharedEngineWorker,
  resetSharedEngineWorkerForTests
} from '../../engine/shared-engine-worker-instance.js';
import type { EngineWorkerLike } from '../../engine/shared-engine-worker.js';
import { EngineModeSelect } from './EngineModeSelect.js';

/** jsdom has no Worker, and the real one would fetch a ~108MB engine. This
 * stands in for it, answering only the uci handshake, and lets the test decide
 * when the engine finishes arriving. */
function fakeWorker(): { worker: EngineWorkerLike; finishInstalling: () => void } {
  const worker: EngineWorkerLike = {
    onmessage: null,
    postMessage: (message: string) => {
      if (message === 'uci') worker.onmessage?.({ data: 'uciok' });
    },
    terminate: () => {}
  };
  return { worker, finishInstalling: () => worker.onmessage?.({ data: 'readyok' }) };
}

describe('EngineModeSelect', () => {
  afterEach(() => resetSharedEngineWorkerForTests());

  test('renders one radio per engine mode, checking the current value', () => {
    render(<EngineModeSelect value="native" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /server engine/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /your browser/i })).not.toBeChecked();
  });

  test('calls onChange with the selected mode', async () => {
    const onChange = vi.fn();
    render(<EngineModeSelect value="native" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: /your browser/i }));

    expect(onChange).toHaveBeenCalledWith('browser');
  });

  test('says nothing about the engine while the server is doing the work', () => {
    render(<EngineModeSelect value="native" onChange={vi.fn()} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // The download is ~108MB and blocks all browser-mode analysis until it lands,
  // so selecting browser mode has to show that something is happening.
  test('reports the engine downloading in browser mode, then ready once it arrives', () => {
    const { worker, finishInstalling } = fakeWorker();
    getSharedEngineWorker({ createWorker: () => worker });

    render(<EngineModeSelect value="browser" onChange={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent(/downloading engine/i);

    act(() => finishInstalling());

    expect(screen.getByRole('status')).toHaveTextContent(/engine ready/i);
  });
});
