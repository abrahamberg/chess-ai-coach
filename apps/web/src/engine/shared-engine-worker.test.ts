import { describe, expect, test, vi } from 'vitest';
import { SharedEngineWorker, type EngineDownloadProgress, type EngineWorkerLike } from './shared-engine-worker.js';

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

  test('reports download progress while installing, then clears it once ready', async () => {
    const worker = fakeWorker();
    let progressPort: MessagePort | undefined;
    (worker as EngineWorkerLike).setProgressPort = (port) => {
      progressPort = port;
    };
    const client = new SharedEngineWorker({ createWorker: () => worker });
    const seen: (EngineDownloadProgress | null)[] = [];
    client.subscribeProgress((progress) => seen.push(progress));

    client.preload();
    expect(seen).toEqual([null]);

    // MessageChannel delivery is asynchronous even between two ports in the
    // same realm, unlike the synchronous fakeWorker.emit() used elsewhere in
    // this file — so this needs an actual tick before onmessage fires.
    progressPort?.postMessage({ percent: 0.5, loaded: 50, total: 100, speedText: '1 MB/s', etaText: '1 sec' });
    await vi.waitFor(() =>
      expect(client.progress).toEqual({
        percent: 0.5,
        loaded: 50,
        total: 100,
        speedText: '1 MB/s',
        etaText: '1 sec'
      })
    );

    worker.emit('uciok');
    worker.emit('readyok');
    expect(client.progress).toBeNull();
  });

  test('a search that never answers with bestmove times out, rejects, and resets the worker for the next call', async () => {
    vi.useFakeTimers();
    try {
      const stuckWorker = fakeWorker();
      const freshWorker = fakeWorker();
      const createWorker = vi.fn().mockReturnValueOnce(stuckWorker).mockReturnValueOnce(freshWorker);
      const client = new SharedEngineWorker({ createWorker });

      const stuck = client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 });
      // Attached before advancing timers so the rejection below never has an
      // unhandled tick between firing and being awaited.
      const stuckAssertion = expect(stuck).rejects.toThrow(/timed out/);
      stuckWorker.emit('uciok');
      stuckWorker.emit('readyok');
      expect(stuckWorker.sent.some((m) => m.startsWith('go'))).toBe(true);

      // No 'bestmove' ever arrives for stuckWorker.
      await vi.advanceTimersByTimeAsync(45_000);
      await stuckAssertion;
      expect(stuckWorker.terminate).toHaveBeenCalledOnce();
      expect(client.status).toBe('absent');

      // A subsequent analyze() gets a brand-new worker rather than reusing
      // the wedged one, and isn't left permanently queued behind it.
      const recovered = client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 });
      freshWorker.emit('uciok');
      freshWorker.emit('readyok');
      freshWorker.emit('info depth 10 multipv 1 score cp 5 pv e2e4');
      freshWorker.emit('bestmove e2e4');
      await expect(recovered).resolves.toMatchObject([{ moveUci: 'e2e4' }]);
      expect(createWorker).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a stuck search also rejects whatever else was queued behind it', async () => {
    vi.useFakeTimers();
    try {
      const stuckWorker = fakeWorker();
      const client = new SharedEngineWorker({ createWorker: () => stuckWorker });

      const stuck = client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 });
      const queued = client.analyze({ fen: START_FEN, depth: 10, multiPv: 1 });
      const stuckAssertion = expect(stuck).rejects.toThrow(/timed out/);
      const queuedAssertion = expect(queued).rejects.toThrow(/reset/);
      stuckWorker.emit('uciok');
      stuckWorker.emit('readyok');

      await vi.advanceTimersByTimeAsync(45_000);
      await stuckAssertion;
      await queuedAssertion;
    } finally {
      vi.useRealTimers();
    }
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
