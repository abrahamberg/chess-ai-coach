export interface EngineWorkerLike {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
  terminate(): void;
}

export interface RawEngineLine {
  multiPv: number;
  moveUci: string;
  cp: number | null;
  mateIn: number | null;
  pvUci: string[];
}

export interface AnalyzeRequest {
  fen: string;
  depth: number;
  multiPv: number;
}

export interface SharedEngineWorkerOptions {
  createWorker?: () => EngineWorkerLike;
}

function defaultCreateWorker(): EngineWorkerLike {
  const workerUrl = new URL('stockfish/bin/stockfish-18-lite-single.js', import.meta.url);
  return new Worker(workerUrl) as unknown as EngineWorkerLike;
}

function parseInfoLine(line: string): RawEngineLine | null {
  if (!line.startsWith('info') || !line.includes(' pv ')) return null;
  const multiPvMatch = /multipv (\d+)/.exec(line);
  const cpMatch = /score cp (-?\d+)/.exec(line);
  const mateMatch = /score mate (-?\d+)/.exec(line);
  const pvMatch = /\bpv (.+)$/.exec(line);
  if (!pvMatch) return null;
  const pvUci = pvMatch[1].trim().split(/\s+/);
  const moveUci = pvUci[0];
  if (!moveUci) return null;
  return {
    multiPv: multiPvMatch ? Number(multiPvMatch[1]) : 1,
    moveUci,
    cp: cpMatch ? Number(cpMatch[1]) : null,
    mateIn: mateMatch ? Number(mateMatch[1]) : null,
    pvUci
  };
}

/** Owns the single WASM Stockfish Worker — shared between the Explore panel
 * and browser-mode tunnel fulfillment so only one engine process ever runs
 * client-side (design spec §5). Serializes analyze() calls: a WASM engine
 * can only run one search at a time. */
export class SharedEngineWorker {
  private worker: EngineWorkerLike | null = null;
  private readonly createWorker: () => EngineWorkerLike;
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: SharedEngineWorkerOptions = {}) {
    this.createWorker = options.createWorker ?? defaultCreateWorker;
  }

  analyze(request: AnalyzeRequest): Promise<RawEngineLine[]> {
    this.ensureWorker();
    const task = this.queue.then(() => this.runAnalysis(request));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private ensureWorker(): { worker: EngineWorkerLike; ready: Promise<void> } {
    if (!this.worker) {
      const worker = this.createWorker();
      this.worker = worker;
      this.ready = new Promise((resolve) => {
        worker.onmessage = (event) => {
          if (event.data === 'uciok') worker.postMessage('isready');
          if (event.data === 'readyok') resolve();
        };
        worker.postMessage('uci');
      });
    }
    return { worker: this.worker, ready: this.ready as Promise<void> };
  }

  private async runAnalysis(request: AnalyzeRequest): Promise<RawEngineLine[]> {
    const { worker, ready } = this.ensureWorker();
    await ready;

    return new Promise<RawEngineLine[]>((resolve) => {
      const lines = new Map<number, RawEngineLine>();
      worker.onmessage = (event) => {
        const line = event.data;
        if (line.startsWith('bestmove')) {
          worker.onmessage = null;
          resolve([...lines.values()].sort((a, b) => a.multiPv - b.multiPv));
          return;
        }
        const parsed = parseInfoLine(line);
        if (parsed) lines.set(parsed.multiPv, parsed);
      };
      worker.postMessage(`setoption name MultiPV value ${request.multiPv}`);
      worker.postMessage(`position fen ${request.fen}`);
      worker.postMessage(`go depth ${request.depth}`);
    });
  }
}
