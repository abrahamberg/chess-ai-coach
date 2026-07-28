import { useCallback, useRef, useState } from 'react';

export interface EngineWorkerLike {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
  terminate(): void;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'analyzing';

export interface EngineBestMoveArrow {
  from: string;
  to: string;
}

export interface UseWasmEngineOptions {
  createWorker?: () => EngineWorkerLike;
}

export interface UseWasmEngineResult {
  status: EngineStatus;
  evaluation: string | null;
  bestMoveArrow: EngineBestMoveArrow | null;
  analyze: (fen: string) => void;
}

// The `stockfish` npm package's lite-single build is a self-contained UCI
// engine worker script (GPLv3) — loaded lazily so the ~7 MB asset never
// touches the main bundle unless a student opens Explore.
function defaultCreateWorker(): EngineWorkerLike {
  const workerUrl = new URL('stockfish/bin/stockfish-18-lite-single.js', import.meta.url);
  return new Worker(workerUrl) as unknown as EngineWorkerLike;
}

function cpToWords(cp: number, sideToMove: 'w' | 'b'): string {
  const whiteCp = sideToMove === 'w' ? cp : -cp;
  const abs = Math.abs(whiteCp);
  const side = whiteCp >= 0 ? 'White' : 'Black';
  if (abs < 50) return 'The position is roughly equal';
  if (abs < 150) return `${side} is slightly better`;
  if (abs < 400) return `${side} is better`;
  if (abs < 900) return `${side} is much better`;
  return `${side} is winning`;
}

function mateToWords(mateIn: number, sideToMove: 'w' | 'b'): string {
  const whiteMateIn = sideToMove === 'w' ? mateIn : -mateIn;
  const side = whiteMateIn > 0 ? 'White' : 'Black';
  return `${side} has a forced mate in ${Math.abs(whiteMateIn)}`;
}

function parseUciSquares(uciMove: string): EngineBestMoveArrow {
  return { from: uciMove.slice(0, 2), to: uciMove.slice(2, 4) };
}

/** design.md §5.6: in-browser Explore engine — word-based evals only, never
 * sent to the server. `createWorker` is injectable so the UCI handshake and
 * eval-wording logic can be unit-tested without a real WASM asset. */
export function useWasmEngine(options: UseWasmEngineOptions = {}): UseWasmEngineResult {
  const createWorker = options.createWorker ?? defaultCreateWorker;
  const workerRef = useRef<EngineWorkerLike | null>(null);
  const sideToMoveRef = useRef<'w' | 'b'>('w');
  const pendingScoreRef = useRef<string | null>(null);

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [evaluation, setEvaluation] = useState<string | null>(null);
  const [bestMoveArrow, setBestMoveArrow] = useState<EngineBestMoveArrow | null>(null);

  const handleMessage = useCallback((line: string) => {
    if (line === 'uciok') {
      workerRef.current?.postMessage('isready');
      return;
    }

    if (line === 'readyok') {
      setStatus('analyzing');
      const worker = workerRef.current;
      if (worker && pendingScoreRef.current) {
        worker.postMessage(`position fen ${pendingScoreRef.current}`);
        worker.postMessage('go depth 15');
      }
      return;
    }

    if (line.startsWith('info') && line.includes('score')) {
      const mateMatch = /score mate (-?\d+)/.exec(line);
      const cpMatch = /score cp (-?\d+)/.exec(line);
      if (mateMatch) {
        setEvaluation(mateToWords(Number(mateMatch[1]), sideToMoveRef.current));
      } else if (cpMatch) {
        setEvaluation(cpToWords(Number(cpMatch[1]), sideToMoveRef.current));
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      const [, uciMove] = line.split(' ');
      if (uciMove) {
        setBestMoveArrow(parseUciSquares(uciMove));
      }
      setStatus('ready');
    }
  }, []);

  const analyze = useCallback(
    (fen: string) => {
      sideToMoveRef.current = fen.split(' ')[1] === 'b' ? 'b' : 'w';

      if (!workerRef.current) {
        setStatus('loading');
        const worker = createWorker();
        worker.onmessage = (event) => handleMessage(event.data);
        workerRef.current = worker;
        pendingScoreRef.current = fen;
        worker.postMessage('uci');
        return;
      }

      const worker = workerRef.current;
      if (status === 'idle' || status === 'loading') {
        pendingScoreRef.current = fen;
        return;
      }
      setStatus('analyzing');
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage('go depth 15');
    },
    [createWorker, handleMessage, status]
  );

  return { status, evaluation, bestMoveArrow, analyze };
}
