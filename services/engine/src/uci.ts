import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { Chess } from 'chess.js';
import type { EngineLine } from '@chess-coach/shared';
import { parseBestMove, parseInfoLine } from './uci-info-parser.js';

const DEFAULT_DEPTH = 16;
const DEFAULT_MULTI_PV = 2;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STOCKFISH_PATH = '/usr/games/stockfish';

export interface AnalyzeOptions {
  depth?: number;
  multiPv?: number;
  timeoutMs?: number;
}

export interface UciEngineOptions {
  stockfishPath?: string;
}

/** Wraps a single Stockfish process over UCI. Lazily spawns the process on the
 * first `analyze()` call and reuses it for subsequent calls until `quit()`. */
export class UciEngine {
  private readonly stockfishPath: string;
  private process: ChildProcessWithoutNullStreams | undefined;
  private lines: EventEmitter | undefined;
  private handshakeDone: Promise<void> | undefined;

  constructor(options: UciEngineOptions = {}) {
    this.stockfishPath =
      options.stockfishPath ?? process.env.STOCKFISH_PATH ?? DEFAULT_STOCKFISH_PATH;
  }

  async analyze(fen: string, options: AnalyzeOptions = {}): Promise<EngineLine[]> {
    const depth = options.depth ?? DEFAULT_DEPTH;
    const multiPv = options.multiPv ?? DEFAULT_MULTI_PV;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    await this.ensureStarted();
    return this.search(fen, depth, multiPv, timeoutMs);
  }

  async quit(): Promise<void> {
    const proc = this.process;
    if (!proc) return;
    this.process = undefined;
    this.lines = undefined;
    this.handshakeDone = undefined;
    proc.stdin.write('quit\n');
    proc.kill();
  }

  private ensureStarted(): Promise<void> {
    this.handshakeDone ??= this.start();
    return this.handshakeDone;
  }

  private async start(): Promise<void> {
    const proc = spawn(this.stockfishPath);
    const lines = new EventEmitter();
    createInterface({ input: proc.stdout }).on('line', (line: string) => lines.emit('line', line));
    this.process = proc;
    this.lines = lines;

    proc.stdin.write('uci\n');
    await waitForLine(lines, (line) => line === 'uciok');
  }

  private async search(
    fen: string,
    depth: number,
    multiPv: number,
    timeoutMs: number
  ): Promise<EngineLine[]> {
    const proc = mustBeStarted(this.process);
    const lines = mustBeStarted(this.lines);
    const mover = fenMoverColor(fen);
    const collected = new Map<number, EngineLine>();

    proc.stdin.write(`setoption name MultiPV value ${multiPv}\n`);
    proc.stdin.write('isready\n');
    await waitForLine(lines, (line) => line === 'readyok');

    proc.stdin.write(`position fen ${fen}\n`);
    proc.stdin.write(`go depth ${depth}\n`);

    return new Promise((resolve) => {
      const timer = setTimeout(() => proc.stdin.write('stop\n'), timeoutMs);

      const onLine = (line: string) => {
        const info = parseInfoLine(line);
        if (info) {
          recordInfoLine(collected, info, fen, mover);
          return;
        }
        if (parseBestMove(line) !== null) {
          clearTimeout(timer);
          lines.off('line', onLine);
          resolve(sortedLines(collected));
        }
      };
      lines.on('line', onLine);
    });
  }
}

function recordInfoLine(
  collected: Map<number, EngineLine>,
  info: NonNullable<ReturnType<typeof parseInfoLine>>,
  fen: string,
  mover: 'white' | 'black'
): void {
  const [moveUci] = info.pvUci;
  if (!moveUci) return;
  const sign = mover === 'white' ? 1 : -1;
  collected.set(info.multipv, {
    moveUci,
    moveSan: uciToSan(fen, moveUci),
    cp: info.cp === null ? null : info.cp * sign,
    mateIn: info.mateIn === null ? null : info.mateIn * sign
  });
}

function sortedLines(collected: Map<number, EngineLine>): EngineLine[] {
  return Array.from(collected.keys())
    .sort((a, b) => a - b)
    .map((key) => {
      const line = collected.get(key);
      if (!line) throw new Error(`unreachable: no line for multipv ${key}`);
      return line;
    });
}

function uciToSan(fen: string, moveUci: string): string {
  const chess = new Chess(fen);
  const from = moveUci.slice(0, 2);
  const to = moveUci.slice(2, 4);
  const promotion = moveUci.length > 4 ? moveUci.slice(4) : undefined;
  const move = chess.move({ from, to, promotion });
  return move.san;
}

function fenMoverColor(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function waitForLine(emitter: EventEmitter, predicate: (line: string) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const onLine = (line: string) => {
      if (predicate(line)) {
        emitter.off('line', onLine);
        resolve();
      }
    };
    emitter.on('line', onLine);
  });
}

function mustBeStarted<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('UciEngine: process not started');
  return value;
}
