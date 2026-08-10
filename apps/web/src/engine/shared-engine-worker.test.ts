import { describe, expect, test, vi } from 'vitest';
import { SharedEngineWorker, type EngineWorkerLike } from './shared-engine-worker.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

describe('SharedEngineWorker', () => {
  test('handshakes uci/isready once, lazily, before the first analyze()', async () => {
    const worker = fakeWorker();
    const client = new SharedEngineWorker({ createWorker: () => worker });

    const pending = client.analyze({ fen: START_FEN, depth: 15, multiPv: 1 });
    expect(worker.sent).toEqual(['uci']);

    worker.emit('uciok');
    expect(worker.sent).toEqual(['uci', 'isready']);
    worker.emit('readyok');

    expect(worker.sent).toContain('setoption name MultiPV value 1');
    expect(worker.sent).toContain(`position fen ${START_FEN}`);
    expect(worker.sent).toContain('go depth 15');

    worker.emit('info depth 15 multipv 1 score cp 25 pv e2e4 e7e5');
    worker.emit('bestmove e2e4 ponder e7e5');

    const lines = await pending;
    expect(lines).toEqual([{ multiPv: 1, moveUci: 'e2e4', cp: 25, mateIn: null, pvUci: ['e2e4', 'e7e5'] }]);
  });

  test('collects one line per multipv slot, sorted by multipv index', async () => {
    const worker = fakeWorker();
    const client = new SharedEngineWorker({ createWorker: () => worker });

    const pending = client.analyze({ fen: START_FEN, depth: 10, multiPv: 2 });
    worker.emit('uciok');
    worker.emit('readyok');

    worker.emit('info depth 10 multipv 2 score cp 10 pv d2d4');
    worker.emit('info depth 10 multipv 1 score cp 25 pv e2e4');
    worker.emit('bestmove e2e4');

    const lines = await pending;
    expect(lines.map((l) => l.multiPv)).toEqual([1, 2]);
  });

  test('serializes concurrent analyze() calls — the second go is not sent until the first bestmove arrives', async () => {
    const worker = fakeWorker();
    const client = new SharedEngineWorker({ createWorker: () => worker });

    const first = client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 });
    const second = client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 });
    worker.emit('uciok');
    worker.emit('readyok');

    expect(worker.sent.filter((m) => m.startsWith('go')).length).toBe(1);
    worker.emit('info depth 10 multipv 1 score cp 25 pv e2e4');
    worker.emit('bestmove e2e4');
    await first;

    expect(worker.sent.filter((m) => m.startsWith('go')).length).toBe(2);
    worker.emit('info depth 10 multipv 1 score mate 3 pv d2d4');
    worker.emit('bestmove d2d4');
    const lines = await second;
    expect(lines[0]).toMatchObject({ mateIn: 3, moveUci: 'd2d4' });
  });

  test('reuses the same worker instance across multiple analyze() calls', async () => {
    const worker = fakeWorker();
    const createWorker = vi.fn(() => worker);
    const client = new SharedEngineWorker({ createWorker });

    const pending = client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 });
    worker.emit('uciok');
    worker.emit('readyok');
    worker.emit('info depth 10 multipv 1 score cp 1 pv e2e4');
    worker.emit('bestmove e2e4');
    await pending;

    const second = client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 });
    worker.emit('info depth 10 multipv 1 score cp 1 pv e2e4');
    worker.emit('bestmove e2e4');
    await second;

    expect(createWorker).toHaveBeenCalledOnce();
  });

  test('reports install status across the handshake', () => {
    const worker = fakeWorker();
    const client = new SharedEngineWorker({ createWorker: () => worker });
    const seen: string[] = [];
    client.subscribe((status) => seen.push(status));

    expect(seen).toEqual(['absent']);

    client.preload();
    expect(client.status).toBe('installing');

    worker.emit('uciok');
    worker.emit('readyok');

    expect(client.status).toBe('ready');
    expect(seen).toEqual(['absent', 'installing', 'ready']);
  });

  // preload() runs from a React effect, so a throw here would surface during
  // commit and take the page down over an engine that merely isn't available.
  test('an engine that cannot be created fails softly rather than throwing', async () => {
    const client = new SharedEngineWorker({
      createWorker: () => {
        throw new ReferenceError('Worker is not defined');
      }
    });

    expect(() => client.preload()).not.toThrow();
    expect(client.status).toBe('absent');

    await expect(client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 })).rejects.toThrow(
      /Worker is not defined/
    );
  });
});
