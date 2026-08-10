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

/**
 * Whether the WASM engine is usable yet.
 *
 * `installing` is not instant and not cosmetic: the full-net build is a ~108MB
 * download on first use, and until it lands browser-mode analysis cannot start
 * at all. Without something to render for this state the app looks idle while
 * it is in fact working.
 */
export type EngineInstallStatus = 'absent' | 'installing' | 'ready';

function defaultCreateWorker(): EngineWorkerLike {
  // The full-net build, NOT `-lite-single`. The lite net is ~7MB against this
  // one's ~108MB, and that gap changes the engine's actual conclusions rather
  // than just its precision: on a sharp middlegame it played Qxc6 (+597) where
  // both this build (+695) and the native backend (+1003) play Qxf6 — at the
  // same depth 16, so it was never a search-depth difference. Browser-mode
  // evaluations are persisted and shown next to server-analyzed games, so they
  // have to come from a comparable engine. `-single` (rather than the threaded
  // `stockfish-18.js`) keeps this working without serving the app
  // cross-origin-isolated for SharedArrayBuffer.
  const workerUrl = new URL('stockfish/bin/stockfish-18-single.js', import.meta.url);
  return new Worker(workerUrl) as unknown as EngineWorkerLike;
}

function parseInfoLine(line: string): RawEngineLine | null {
  if (!line.startsWith('info') || !line.includes(' pv ')) return null;
  const multiPvMatch = /multipv (\d+)/.exec(line);
  const cpMatch = /score cp (-?\d+)/.exec(line);
  const mateMatch = /score mate (-?\d+)/.exec(line);
  const pvMatch = /\bpv (.+)$/.exec(line);
  if (!pvMatch) return null;
  const pvUci = pvMatch[1]!.trim().split(/\s+/);
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

interface QueuedAnalysis {
  request: AnalyzeRequest;
  resolve: (lines: RawEngineLine[]) => void;
  reject: (error: Error) => void;
}

/** Owns the single WASM Stockfish Worker — shared between the Explore panel
 * and browser-mode tunnel fulfillment so only one engine process ever runs
 * client-side (design spec §5). Serializes analyze() calls: a WASM engine
 * can only run one search at a time.
 *
 * Driven entirely off worker.onmessage callbacks rather than promise chains:
 * a `.then()` continuation is always deferred to a microtask, which would
 * make a command sent "in response to" a worker message arrive one tick
 * late and could drop messages emitted before that tick fires. Queuing and
 * dispatch below run synchronously — inside the Promise executor in
 * analyze() and inside the onmessage handlers — so sent commands are
 * observable immediately after the event that triggers them. */
export class SharedEngineWorker {
  private worker: EngineWorkerLike | null = null;
  private readonly createWorker: () => EngineWorkerLike;
  private isReady = false;
  private active = false;
  private readonly pending: QueuedAnalysis[] = [];
  private engineInstallStatus: EngineInstallStatus = 'absent';
  private readonly listeners = new Set<(status: EngineInstallStatus) => void>();

  constructor(options: SharedEngineWorkerOptions = {}) {
    this.createWorker = options.createWorker ?? defaultCreateWorker;
  }

  get status(): EngineInstallStatus {
    return this.engineInstallStatus;
  }

  /** Notifies on every status change and immediately with the current value,
   * so a component mounting mid-download still renders the right thing.
   * Returns an unsubscribe. */
  subscribe(listener: (status: EngineInstallStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.engineInstallStatus);
    return () => this.listeners.delete(listener);
  }

  /** Starts the engine without queueing work, so the UI can report on (and
   * begin) the download before the first analysis actually needs it. */
  preload(): void {
    this.ensureWorker();
  }

  /** Settles anything queued when the engine turns out to be unusable —
   * otherwise those callers await a search that can never start. */
  private rejectPending(error: unknown): void {
    const reason = error instanceof Error ? error : new Error(String(error));
    while (this.pending.length > 0) this.pending.shift()?.reject(reason);
  }

  private setStatus(status: EngineInstallStatus): void {
    if (this.engineInstallStatus === status) return;
    this.engineInstallStatus = status;
    for (const listener of this.listeners) listener(status);
  }

  analyze(request: AnalyzeRequest): Promise<RawEngineLine[]> {
    return new Promise((resolve, reject) => {
      this.pending.push({ request, resolve, reject });
      this.ensureWorker();
      this.pump();
    });
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.setStatus('installing');

    let worker: EngineWorkerLike;
    try {
      worker = this.createWorker();
    } catch (error) {
      // Constructing the Worker can fail outright: no Worker global (tests,
      // SSR), or a blocked/failed engine fetch. This runs from preload(),
      // which useEngineStatus calls in an effect, so throwing here would
      // surface inside React's commit phase and take the page down over an
      // engine that merely isn't available. Report it as absent instead and
      // let the next attempt retry.
      this.setStatus('absent');
      this.rejectPending(error);
      return;
    }

    this.worker = worker;
    worker.onmessage = (event) => {
      if (event.data === 'uciok') {
        worker.postMessage('isready');
        return;
      }
      if (event.data === 'readyok') {
        this.isReady = true;
        this.setStatus('ready');
        this.pump();
      }
    };
    worker.postMessage('uci');
  }

  private pump(): void {
    if (this.active || !this.isReady || this.pending.length === 0) return;
    const worker = this.worker;
    if (!worker) return;
    const next = this.pending.shift();
    if (!next) return;
    const { request, resolve } = next;
    this.active = true;

    const lines = new Map<number, RawEngineLine>();
    worker.onmessage = (event) => {
      const line = event.data;
      if (line.startsWith('bestmove')) {
        this.active = false;
        resolve([...lines.values()].sort((a, b) => a.multiPv - b.multiPv));
        this.pump();
        return;
      }
      const parsed = parseInfoLine(line);
      if (parsed) lines.set(parsed.multiPv, parsed);
    };
    worker.postMessage(`setoption name MultiPV value ${request.multiPv}`);
    worker.postMessage(`position fen ${request.fen}`);
    worker.postMessage(`go depth ${request.depth}`);
  }
}
