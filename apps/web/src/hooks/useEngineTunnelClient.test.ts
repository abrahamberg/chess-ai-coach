import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useEngineTunnelClient } from './useEngineTunnelClient.js';
import { SharedEngineWorker, type EngineWorkerLike } from '../engine/shared-engine-worker.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Replaces the real singleton with one backed by a fake worker that
// auto-answers as soon as the UCI handshake starts, so this hook's tests
// never touch the real WASM asset and resolve on the next microtask.
function autoRespondingWorker(sentToWorker: string[] = []): EngineWorkerLike {
  const worker: EngineWorkerLike = {
    onmessage: null,
    postMessage(message: string) {
      sentToWorker.push(message);
      if (message === 'uci') queueMicrotask(() => worker.onmessage?.({ data: 'uciok' }));
      if (message === 'isready') queueMicrotask(() => worker.onmessage?.({ data: 'readyok' }));
      if (message.startsWith('go')) {
        queueMicrotask(() => {
          worker.onmessage?.({ data: mockInfoLine });
          worker.onmessage?.({ data: 'bestmove e2e4 ponder e7e5' });
        });
      }
    },
    terminate: vi.fn()
  };
  return worker;
}

let sentToWorker: string[] = [];
let mockInfoLine = 'info depth 10 multipv 1 score cp 20 pv e2e4 e7e5';

vi.mock('../engine/shared-engine-worker-instance.js', () => ({
  getSharedEngineWorker: () => new SharedEngineWorker({ createWorker: () => autoRespondingWorker(sentToWorker) })
}));

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  readyState = 1;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
  }

  emitMessage(data: string): void {
    this.onmessage?.({ data });
  }

  // Simulates the server (or an idle-timeout proxy in front of it) dropping
  // the connection — distinct from close(), which is the client hanging up.
  closeFromServer(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

describe('useEngineTunnelClient', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    sentToWorker = [];
    mockInfoLine = 'info depth 10 multipv 1 score cp 20 pv e2e4 e7e5';
    vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  test('does not open a socket when disabled', () => {
    renderHook(() => useEngineTunnelClient({ enabled: false }));
    expect(FakeSocket.instances).toHaveLength(0);
  });

  test('opens a socket to wsUrl when enabled, and closes it on unmount', () => {
    const { unmount } = renderHook(() => useEngineTunnelClient({ enabled: true, wsUrl: 'ws://localhost/api/engine-tunnel' }));
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]!.url).toBe('ws://localhost/api/engine-tunnel');

    unmount();
    expect(FakeSocket.instances[0]!.closed).toBe(true);
  });

  test('answers an analyze-position request with a validated-shape PositionAnalysis over the socket', async () => {
    renderHook(() => useEngineTunnelClient({ enabled: true, wsUrl: 'ws://localhost/api/engine-tunnel' }));
    const socket = FakeSocket.instances[0]!;

    socket.emitMessage(JSON.stringify({ requestId: 'req-1', kind: 'analyze-position', fen: START_FEN, depth: 10, multiPv: 1 }));
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));

    const response = JSON.parse(socket.sent[0]!) as { requestId: string; ok: boolean; result?: { fen: string } };
    expect(response.requestId).toBe('req-1');
    expect(response.ok).toBe(true);
    expect(response.result?.fen).toBe(START_FEN);
  });

  // Regression: analyzeGameForTunnel used to hardcode multiPv:1 to the
  // worker regardless of what apps/api requested, silently degrading every
  // browser-mode game analysis to a single principal variation.
  test('an analyze-game request honors the requested multiPv instead of hardcoding 1', async () => {
    renderHook(() => useEngineTunnelClient({ enabled: true, wsUrl: 'ws://localhost/api/engine-tunnel' }));
    const socket = FakeSocket.instances[0]!;

    socket.emitMessage(
      JSON.stringify({ requestId: 'req-2', kind: 'analyze-game', fens: [START_FEN], depth: 10, multiPv: 2 })
    );
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));

    expect(sentToWorker).toContain('setoption name MultiPV value 2');
    expect(sentToWorker).not.toContain('setoption name MultiPV value 1');
  });

  // Regression: the raw UCI `score cp` is relative to whichever side is to
  // move in the position being analyzed (confirmed by shared-engine-worker's
  // own tests and by useWasmEngine.ts, which does its own `sideToMove === 'w'
  // ? cp : -cp` conversion before displaying it). The native engine backend
  // (services/engine/src/uci.ts recordInfoLine) converts this to a
  // white-perspective cp before it ever reaches the shared EngineEval shape.
  // The tunnel handlers used to skip that conversion entirely, so every
  // black-to-move position's eval was stored with an inverted sign relative
  // to what classify.ts (and the native backend) expect -- producing wildly
  // incoherent-looking move classifications for browser-analyzed games.
  const BLACK_TO_MOVE_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

  test('an analyze-position request converts a black-to-move eval to white-perspective cp', async () => {
    mockInfoLine = 'info depth 10 multipv 1 score cp 50 pv d7d5';
    renderHook(() => useEngineTunnelClient({ enabled: true, wsUrl: 'ws://localhost/api/engine-tunnel' }));
    const socket = FakeSocket.instances[0]!;

    socket.emitMessage(
      JSON.stringify({ requestId: 'req-3', kind: 'analyze-position', fen: BLACK_TO_MOVE_FEN, depth: 10, multiPv: 1 })
    );
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));

    const response = JSON.parse(socket.sent[0]!) as {
      result?: { eval: { cp: number | null }; lines: Array<{ cp: number | null }> };
    };
    // Black reports +50 for itself, so white-perspective must be -50.
    expect(response.result?.eval.cp).toBe(-50);
    expect(response.result?.lines[0]?.cp).toBe(-50);
  });

  test('an analyze-game request converts a black-to-move eval to white-perspective cp', async () => {
    mockInfoLine = 'info depth 10 multipv 1 score cp 50 pv d7d5';
    renderHook(() => useEngineTunnelClient({ enabled: true, wsUrl: 'ws://localhost/api/engine-tunnel' }));
    const socket = FakeSocket.instances[0]!;

    socket.emitMessage(
      JSON.stringify({ requestId: 'req-4', kind: 'analyze-game', fens: [BLACK_TO_MOVE_FEN], depth: 10, multiPv: 1 })
    );
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));

    const response = JSON.parse(socket.sent[0]!) as { result?: Array<{ lines: Array<{ cp: number | null }> }> };
    expect(response.result?.[0]?.lines[0]?.cp).toBe(-50);
  });

  // Regression: nginx-ingress's default 60s proxy-read-timeout silently
  // drops an idle tunnel — a game import submitted after that point failed
  // instantly with "No tunnel connection" and stayed broken until the tab
  // was reloaded, since nothing kept the connection alive or reconnected it.
  describe('keepalive and reconnect', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test('pings periodically once open, to keep an idle-timeout proxy from closing the socket', async () => {
      renderHook(() => useEngineTunnelClient({ enabled: true, wsUrl: 'ws://localhost/api/engine-tunnel' }));
      const socket = FakeSocket.instances[0]!;
      await vi.advanceTimersByTimeAsync(0); // flush the constructor's onopen microtask
      expect(socket.sent).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(socket.sent).toHaveLength(1);
      expect(JSON.parse(socket.sent[0]!)).not.toHaveProperty('requestId');

      await vi.advanceTimersByTimeAsync(20_000);
      expect(socket.sent).toHaveLength(2);
    });

    test('reconnects after the server drops the connection', async () => {
      renderHook(() => useEngineTunnelClient({ enabled: true, wsUrl: 'ws://localhost/api/engine-tunnel' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(FakeSocket.instances).toHaveLength(1);

      FakeSocket.instances[0]!.closeFromServer();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(FakeSocket.instances).toHaveLength(2);
      expect(FakeSocket.instances[1]!.url).toBe('ws://localhost/api/engine-tunnel');
    });

    test('does not reconnect once unmounted', async () => {
      const { unmount } = renderHook(() => useEngineTunnelClient({ enabled: true, wsUrl: 'ws://localhost/api/engine-tunnel' }));
      await vi.advanceTimersByTimeAsync(0);

      FakeSocket.instances[0]!.closeFromServer();
      unmount();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(FakeSocket.instances).toHaveLength(1);
    });
  });
});
