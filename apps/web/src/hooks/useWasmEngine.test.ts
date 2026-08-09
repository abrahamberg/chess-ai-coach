import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useWasmEngine } from './useWasmEngine.js';
import { resetSharedEngineWorkerForTests } from '../engine/shared-engine-worker-instance.js';
import type { EngineWorkerLike } from '../engine/shared-engine-worker.js';

function fakeWorker(): EngineWorkerLike & { sent: string[]; emit: (line: string) => void } {
  const sent: string[] = [];
  const worker: EngineWorkerLike & { sent: string[]; emit: (line: string) => void } = {
    sent,
    onmessage: null,
    postMessage: (message: string) => sent.push(message),
    terminate: vi.fn(),
    emit: (line: string) => worker.onmessage?.({ data: line })
  };
  return worker;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('useWasmEngine', () => {
  beforeEach(() => resetSharedEngineWorkerForTests());
  afterEach(() => resetSharedEngineWorkerForTests());

  test('lazily creates the worker only on first analyze() call', () => {
    const worker = fakeWorker();
    const createWorker = vi.fn(() => worker);
    const { result } = renderHook(() => useWasmEngine({ createWorker }));

    expect(createWorker).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');

    act(() => result.current.analyze(START_FEN));
    expect(createWorker).toHaveBeenCalledOnce();
  });

  test('reports a word-based eval and best-move arrow once the engine settles', async () => {
    const worker = fakeWorker();
    const { result } = renderHook(() => useWasmEngine({ createWorker: () => worker }));

    await act(async () => {
      result.current.analyze(START_FEN);
      worker.emit('uciok');
      worker.emit('readyok');
      worker.emit('info depth 15 multipv 1 score cp 250 pv e2e4 e7e5');
      worker.emit('bestmove e2e4 ponder e7e5');
      await Promise.resolve();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.evaluation).toBe('White is better');
    expect(result.current.bestMoveArrow).toEqual({ from: 'e2', to: 'e4' });
  });

  test('reports forced mate lines in words', async () => {
    const worker = fakeWorker();
    const { result } = renderHook(() => useWasmEngine({ createWorker: () => worker }));

    await act(async () => {
      result.current.analyze(START_FEN);
      worker.emit('uciok');
      worker.emit('readyok');
      worker.emit('info depth 12 multipv 1 score mate 3 pv e2e4');
      worker.emit('bestmove e2e4');
      await Promise.resolve();
    });

    expect(result.current.evaluation).toBe('White has a forced mate in 3');
  });

  test('flips the perspective for black to move', async () => {
    const worker = fakeWorker();
    const { result } = renderHook(() => useWasmEngine({ createWorker: () => worker }));
    const blackToMoveFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

    await act(async () => {
      result.current.analyze(blackToMoveFen);
      worker.emit('uciok');
      worker.emit('readyok');
      worker.emit('info depth 12 multipv 1 score cp 250 pv d7d5');
      worker.emit('bestmove d7d5');
      await Promise.resolve();
    });

    expect(result.current.evaluation).toBe('Black is better');
  });
});
