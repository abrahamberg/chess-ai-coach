import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EngineTunnelRegistry } from './engine-tunnel-registry.js';
import { EngineUnavailableError } from '../../lib/errors.js';

// Minimal WebSocket-like connection for testing
interface FakeTunnelConnection {
  send(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}

describe('EngineTunnelRegistry', () => {
  let registry: EngineTunnelRegistry;

  beforeEach(() => {
    registry = new EngineTunnelRegistry();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('request() waits for a response with matching requestId and resolves', async () => {
    // Setup: create a fake connection
    const fakeConnection: FakeTunnelConnection = {
      send: vi.fn(),
      onmessage: null
    };

    // Register the connection for a user
    registry.registerConnection('user123', fakeConnection);

    // Start the request
    const requestPromise = registry.request('user123', { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 10 }, 5000);

    // Simulate the browser sending a response back
    // We need to capture the requestId from the sent message first
    const sendMock = fakeConnection.send as ReturnType<typeof vi.fn>;
    const sentMessage = JSON.parse(sendMock.mock.calls[0]![0] as string);
    const requestId = sentMessage.requestId as string;

    // Simulate browser response
    if (fakeConnection.onmessage) {
      fakeConnection.onmessage({
        data: JSON.stringify({
          requestId,
          result: { cp: 20, lines: [] }
        })
      });
    }

    const result = await requestPromise;
    expect(result).toEqual({ cp: 20, lines: [] });
  });

  it('request() throws EngineUnavailableError immediately if no connection for that userId', async () => {
    const promise = registry.request('nonexistent-user', { fen: 'test' }, 5000);

    await expect(promise).rejects.toThrow(EngineUnavailableError);
  });

  it('request() throws EngineUnavailableError after timeout if no response arrives', async () => {
    vi.useFakeTimers();

    const fakeConnection: FakeTunnelConnection = {
      send: vi.fn(),
      onmessage: null
    };

    registry.registerConnection('user123', fakeConnection);

    const promise = registry.request('user123', { fen: 'test' }, 100);

    // Advance time past the timeout
    vi.advanceTimersByTime(150);

    await expect(promise).rejects.toThrow(EngineUnavailableError);

    vi.useRealTimers();
  });

  it('request() throws EngineUnavailableError if response contains error field', async () => {
    const fakeConnection: FakeTunnelConnection = {
      send: vi.fn(),
      onmessage: null
    };

    registry.registerConnection('user123', fakeConnection);

    const requestPromise = registry.request('user123', { fen: 'test' }, 5000);

    // Capture requestId from sent message
    const sendMock = fakeConnection.send as ReturnType<typeof vi.fn>;
    const sentMessage = JSON.parse(sendMock.mock.calls[0]![0] as string);
    const requestId = sentMessage.requestId as string;

    // Simulate error response
    if (fakeConnection.onmessage) {
      fakeConnection.onmessage({
        data: JSON.stringify({
          requestId,
          error: 'Engine analysis failed'
        })
      });
    }

    await expect(requestPromise).rejects.toThrow(EngineUnavailableError);
  });

  it('registerConnection() replaces previous connection for that userId', async () => {
    const connection1: FakeTunnelConnection = {
      send: vi.fn(),
      onmessage: null
    };

    const connection2: FakeTunnelConnection = {
      send: vi.fn(),
      onmessage: null
    };

    // Register first connection
    registry.registerConnection('user123', connection1);

    // Start a request on the first connection
    const promise1 = registry.request('user123', { fen: 'test1' }, 5000);

    // Register second connection (should replace the first)
    registry.registerConnection('user123', connection2);

    // Start a request on the second connection
    const promise2 = registry.request('user123', { fen: 'test2' }, 5000);

    // Get requestIds
    const sendMock1 = connection1.send as ReturnType<typeof vi.fn>;
    const sendMock2 = connection2.send as ReturnType<typeof vi.fn>;
    const sentMessage1 = JSON.parse(sendMock1.mock.calls[0]![0] as string);
    const sentMessage2 = JSON.parse(sendMock2.mock.calls[0]![0] as string);
    const requestId1 = sentMessage1.requestId as string;
    const requestId2 = sentMessage2.requestId as string;

    // Send response on connection2 with requestId2
    if (connection2.onmessage) {
      connection2.onmessage({
        data: JSON.stringify({
          requestId: requestId2,
          result: { cp: 50 }
        })
      });
    }

    // Verify that promise2 resolves
    const result2 = await promise2;
    expect(result2).toEqual({ cp: 50 });

    // Send response on connection1 with requestId1 (should not resolve promise1)
    // because connection1 was replaced
    if (connection1.onmessage) {
      connection1.onmessage({
        data: JSON.stringify({
          requestId: requestId1,
          result: { cp: 30 }
        })
      });
    }

    // Promise1 should still be pending (or timeout)
    // We'll just verify it wasn't resolved with the wrong result
    vi.useFakeTimers();
    vi.advanceTimersByTime(50); // Don't go to full timeout
    await expect(promise1.then(() => 'resolved', () => 'rejected')).resolves.toBe('rejected');
    vi.useRealTimers();
  });

  it('unregisterConnection() cleans up pending timeouts', async () => {
    vi.useFakeTimers();

    const fakeConnection: FakeTunnelConnection = {
      send: vi.fn(),
      onmessage: null
    };

    registry.registerConnection('user123', fakeConnection);

    // Start a request with a long timeout
    const promise = registry.request('user123', { fen: 'test' }, 5000);

    // Unregister the connection
    registry.unregisterConnection('user123');

    // The promise should reject immediately (not after 5000ms)
    vi.advanceTimersByTime(100); // Advance just a bit
    await expect(promise).rejects.toThrow(EngineUnavailableError);

    vi.useRealTimers();
  });

  // Regression: a reload/second tab registers its socket before the old one's
  // 'close' lands. The late close must not evict the tab that replaced it, or
  // the user sits there connected while every job fails "No tunnel connection".
  it('unregisterConnection() ignores a stale connection that has already been replaced', async () => {
    const oldConnection: FakeTunnelConnection = { send: vi.fn(), onmessage: null };
    const newConnection: FakeTunnelConnection = { send: vi.fn(), onmessage: null };

    registry.registerConnection('user123', oldConnection);
    registry.registerConnection('user123', newConnection);

    // The replaced tab's socket closes *after* the new one registered.
    registry.unregisterConnection('user123', oldConnection);

    // The live connection must still be the one that receives requests.
    void registry.request('user123', { fen: 'test' }, 5000);
    expect(newConnection.send).toHaveBeenCalled();
    expect(oldConnection.send).not.toHaveBeenCalled();
  });

  it('unregisterConnection() still removes the connection when it is the current one', async () => {
    const connection: FakeTunnelConnection = { send: vi.fn(), onmessage: null };

    registry.registerConnection('user123', connection);
    registry.unregisterConnection('user123', connection);

    await expect(registry.request('user123', { fen: 'test' }, 5000)).rejects.toThrow(EngineUnavailableError);
  });
});
