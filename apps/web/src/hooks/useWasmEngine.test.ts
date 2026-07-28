import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useWasmEngine, type EngineWorkerLike } from './useWasmEngine.js';

function fakeWorker(): EngineWorkerLike & { sent: string[]; emit: (line: string) => void } {
  const sent: string[] = [];
  const worker: EngineWorkerLike & { sent: string[]; emit: (line: string) => void } = {
    sent,
    onmessage: null,
    postMessage(message: string) {
      sent.push(message);
    },
    terminate: vi.fn(),
    emit(line: string) {
      worker.onmessage?.({ data: line } as MessageEvent<string>);
    }
  };
  return worker;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('useWasmEngine', () => {
  test('lazily creates the worker only on first analyze() call', () => {
    const worker = fakeWorker();
    const createWorker = vi.fn(() => worker);
    const { result } = renderHook(() => useWasmEngine({ createWorker }));

    expect(createWorker).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');

    act(() => result.current.analyze(START_FEN));
    expect(createWorker).toHaveBeenCalledOnce();
  });

  test('handshakes uci/isready before sending the position, then reports a word-based eval and best-move arrow', () => {
    const worker = fakeWorker();
    const { result } = renderHook(() => useWasmEngine({ createWorker: () => worker }));

    act(() => result.current.analyze(START_FEN));
    expect(worker.sent).toEqual(['uci']);

    act(() => worker.emit('uciok'));
    expect(worker.sent).toEqual(['uci', 'isready']);

    act(() => worker.emit('readyok'));
    expect(worker.sent).toContain(`position fen ${START_FEN}`);
    expect(worker.sent).toContain('go depth 15');
    expect(result.current.status).toBe('analyzing');

    act(() => worker.emit('info depth 15 score cp 250 pv e2e4 e7e5'));
    act(() => worker.emit('bestmove e2e4 ponder e7e5'));

    expect(result.current.status).toBe('ready');
    expect(result.current.evaluation).toBe('White is better');
    expect(result.current.bestMoveArrow).toEqual({ from: 'e2', to: 'e4' });
  });

  test('reports forced mate lines in words', () => {
    const worker = fakeWorker();
    const { result } = renderHook(() => useWasmEngine({ createWorker: () => worker }));

    act(() => result.current.analyze(START_FEN));
    act(() => worker.emit('uciok'));
    act(() => worker.emit('readyok'));
    act(() => worker.emit('info depth 12 score mate 3 pv e2e4'));
    act(() => worker.emit('bestmove e2e4'));

    expect(result.current.evaluation).toBe('White has a forced mate in 3');
  });

  test('flips the perspective for black to move', () => {
    const worker = fakeWorker();
    const { result } = renderHook(() => useWasmEngine({ createWorker: () => worker }));
    const blackToMoveFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

    act(() => result.current.analyze(blackToMoveFen));
    act(() => worker.emit('uciok'));
    act(() => worker.emit('readyok'));
    act(() => worker.emit('info depth 12 score cp 250 pv d7d5'));
    act(() => worker.emit('bestmove d7d5'));

    expect(result.current.evaluation).toBe('Black is better');
  });
});
