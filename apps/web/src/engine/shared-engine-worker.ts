export interface EngineWorkerLike {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
  terminate(): void;
  /** Hands the worker a MessagePort it can stream WASM download progress on
   * (see defaultCreateWorker). Optional because test fakes have no download
   * to report progress on. */
  setProgressPort?(port: MessagePort): void;
}

/** Shape of the periodic message the stockfish.js worker build posts on the
 * progress port while it downloads/instantiates the WASM binary. speedText
 * and etaText are the library's own human-readable formatting (e.g.
 * "60.4 MB/s", "2 sec") — reused as-is rather than reformatting loaded/total
 * ourselves. */
export interface EngineDownloadProgress {
  percent: number;
  loaded: number;
  total: number;
  speedText: string | null;
  etaText: string | null;
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
  //
  // The `new URL(..., import.meta.url)` on both lines below is load-bearing,
  // not decoration: it's what makes Vite treat each file as a static asset it
  // must copy into the build and content-hash, rather than something that
  // only exists in node_modules at dev time. Without the second one, the
  // build ships the (hashed) .js but never the .wasm it needs at runtime —
  // that gap is exactly what was 404ing in production.
  //
  // The worker script has no config-object entry point in worker mode (it
  // hardcodes its own bootstrap instead of accepting `Module.locateFile`), so
  // the only supported way to tell it where its .wasm actually lives is the
  // URL-fragment convention it reads out of `self.location.hash` on startup.
  //
  // Both `new URL(<string literal>, import.meta.url)` calls must keep a bare
  // string literal as their first argument — that's what Vite's static
  // analysis pattern-matches on to know to copy+hash the file. Building the
  // path with a template literal (e.g. to splice the hash fragment in
  // directly) makes Vite stop recognizing the call, and it silently drops
  // the asset from the build instead of erroring. So the fragment gets
  // spliced on by mutating the resulting URL object instead, after both
  // literal-argument calls have already been made.
  const wasmUrl = new URL('stockfish/bin/stockfish-18-single.wasm', import.meta.url);
  const workerUrl = new URL('stockfish/bin/stockfish-18-single.js', import.meta.url);
  workerUrl.hash = encodeURIComponent(wasmUrl.href);
  const worker = new Worker(workerUrl) as unknown as EngineWorkerLike & {
    postMessage(message: unknown, transfer?: Transferable[]): void;
  };
  // Also part of the same worker-mode protocol: give it a MessagePort and it
  // streams { percent, loaded, total, ... } on it while fetching the wasm —
  // see EngineInstallProgress below.
  worker.setProgressPort = (port) => worker.postMessage({ progressPort: port }, [port]);
  return worker;
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
  private installProgress: EngineDownloadProgress | null = null;
  private readonly progressListeners = new Set<(progress: EngineDownloadProgress | null) => void>();

  constructor(options: SharedEngineWorkerOptions = {}) {
    this.createWorker = options.createWorker ?? defaultCreateWorker;
  }

  get status(): EngineInstallStatus {
    return this.engineInstallStatus;
  }

  get progress(): EngineDownloadProgress | null {
    return this.installProgress;
  }

  /** Notifies on every status change and immediately with the current value,
   * so a component mounting mid-download still renders the right thing.
   * Returns an unsubscribe. */
  subscribe(listener: (status: EngineInstallStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.engineInstallStatus);
    return () => this.listeners.delete(listener);
  }

  /** Notifies with the download's { percent, loaded, total } while status is
   * 'installing', and with null outside of that (no download in flight, or
   * the worker build doesn't report progress). Returns an unsubscribe. */
  subscribeProgress(listener: (progress: EngineDownloadProgress | null) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.installProgress);
    return () => this.progressListeners.delete(listener);
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

  private setProgress(progress: EngineDownloadProgress | null): void {
    this.installProgress = progress;
    for (const listener of this.progressListeners) listener(progress);
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

    // Guarded rather than assumed: MessageChannel doesn't exist in jsdom
    // (the test environment), and setProgressPort is unset on every test
    // fake — this is real-browser-only, and progress reporting is a nicety
    // the engine can work fine without.
    if (worker.setProgressPort && typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const data = event.data as Partial<EngineDownloadProgress> | undefined;
        if (typeof data?.percent !== 'number') return;
        this.setProgress({
          percent: data.percent,
          loaded: data.loaded ?? 0,
          total: data.total ?? 0,
          speedText: data.speedText ?? null,
          etaText: data.etaText ?? null
        });
      };
      worker.setProgressPort(channel.port2);
    }

    worker.onmessage = (event) => {
      if (event.data === 'uciok') {
        worker.postMessage('isready');
        return;
      }
      if (event.data === 'readyok') {
        this.isReady = true;
        this.setStatus('ready');
        this.setProgress(null);
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
