import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useEngineTunnelClient } from './useEngineTunnelClient.js';
import { SharedEngineWorker, type EngineWorkerLike } from '../engine/shared-engine-worker.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Replaces the real singleton with one backed by a fake worker that
// auto-answers as soon as the UCI handshake starts, so this hook's tests
// never touch the real WASM asset and resolve on the next microtask.
function autoRespondingWorker(): EngineWorkerLike {
  const worker: EngineWorkerLike = {
    onmessage: null,
    postMessage(message: string) {
      if (message === 'uci') queueMicrotask(() => worker.onmessage?.({ data: 'uciok' }));
      if (message === 'isready') queueMicrotask(() => worker.onmessage?.({ data: 'readyok' }));
      if (message.startsWith('go')) {
        queueMicrotask(() => {
          worker.onmessage?.({ data: 'info depth 10 multipv 1 score cp 20 pv e2e4 e7e5' });
          worker.onmessage?.({ data: 'bestmove e2e4 ponder e7e5' });
        });
      }
    },
    terminate: vi.fn()
  };
  return worker;
}

vi.mock('../engine/shared-engine-worker-instance.js', () => ({
  getSharedEngineWorker: () => new SharedEngineWorker({ createWorker: autoRespondingWorker })
}));

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  readyState = 1;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
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
}

describe('useEngineTunnelClient', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
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
});
