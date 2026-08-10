import { randomUUID } from 'crypto';
import { EngineUnavailableError } from '../../lib/errors.js';
import type { EngineTunnelTransport } from './engine-tunnel-transport.js';

/**
 * Minimal WebSocket-like connection interface for tunnel communication.
 * Used by EngineTunnelRegistry to send and receive correlated requests.
 */
export interface TunnelConnection {
  send(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}

/**
 * Handler for a pending request waiting for a response.
 * Stores resolve/reject callbacks and timeout ID for cleanup.
 */
interface RequestHandler {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId: NodeJS.Timeout;
}

/**
 * Stores per-user connection state and pending request handlers.
 */
interface ConnectionState {
  connection: TunnelConnection;
  requestHandlers: Map<string, RequestHandler>;
}

/**
 * EngineTunnelRegistry holds active browser tunnel connections and routes
 * correlated requests to them. Implements the request/response pattern with
 * per-request timeouts (no fallback — fail fast if tunnel unavailable).
 *
 * One registry is shared by the API process (direct access) and worker process
 * (HTTP relay). Connections are registered by the WebSocket route (Task 7).
 */
export class EngineTunnelRegistry implements EngineTunnelTransport {
  private connections: Map<string, ConnectionState> = new Map();

  /**
   * Register a browser connection for a user. If the user already has a
   * connection, it is replaced (last-connected-tab wins).
   *
   * The connection must have a `send()` method and support `onmessage` callback.
   * The registry will set up the onmessage handler to receive responses.
   *
   * @param userId - The user ID to associate with this connection
   * @param connection - The WebSocket-like connection
   */
  registerConnection(userId: string, connection: TunnelConnection): void {
    // Clean up any previous connection for this user
    const existing = this.connections.get(userId);
    if (existing) {
      // Reject all pending requests on the old connection
      for (const handler of existing.requestHandlers.values()) {
        clearTimeout(handler.timeoutId);
        handler.reject(new EngineUnavailableError('Connection replaced'));
      }
    }

    const state: ConnectionState = {
      connection,
      requestHandlers: new Map()
    };

    // Set up the onmessage handler to route responses to pending requests
    connection.onmessage = (event: { data: string }) => {
      try {
        const message = JSON.parse(event.data);
        const requestId = message.requestId as string | undefined;

        if (!requestId) {
          // Ignore messages without requestId
          return;
        }

        const handler = state.requestHandlers.get(requestId);
        if (!handler) {
          // Ignore responses for unknown requests
          return;
        }

        // Remove the handler immediately
        state.requestHandlers.delete(requestId);
        clearTimeout(handler.timeoutId);

        // Check if the response contains an error
        if (message.error) {
          handler.reject(new EngineUnavailableError(message.error as string));
        } else if (message.result !== undefined) {
          handler.resolve(message.result);
        } else {
          // Response has neither error nor result
          handler.reject(new EngineUnavailableError('Invalid response: missing result or error'));
        }
      } catch (err) {
        // Ignore parsing errors (malformed JSON)
        console.error('Error parsing tunnel message:', err);
      }
    };

    this.connections.set(userId, state);
  }

  /**
   * Unregister a user's connection and clean up all pending requests.
   * All pending requests will be rejected with EngineUnavailableError.
   *
   * @param userId - The user ID to unregister
   * @param connection - The connection being closed. Pass it whenever you have
   *   it: registerConnection() is last-tab-wins, and a replaced tab's socket
   *   routinely emits its 'close' *after* the replacing tab has registered
   *   (any reload, route change that remounts, or second tab does this). Without
   *   this identity check that late close evicts the *live* connection, leaving
   *   a user with a connected tab but no tunnel — every subsequent job then
   *   fails with "No tunnel connection for user …". Omitting it keeps the old
   *   unconditional behaviour for callers that genuinely want to drop whatever
   *   is registered.
   */
  unregisterConnection(userId: string, connection?: TunnelConnection): void {
    const state = this.connections.get(userId);
    if (!state) {
      return;
    }
    if (connection && state.connection !== connection) {
      return;
    }

    // Reject all pending requests
    for (const handler of state.requestHandlers.values()) {
      clearTimeout(handler.timeoutId);
      handler.reject(new EngineUnavailableError('Connection unregistered'));
    }

    this.connections.delete(userId);
  }

  /**
   * Send a request to a browser connection and wait for the response.
   * Implements EngineTunnelTransport.request().
   *
   * @param userId - The user ID whose browser should receive the request
   * @param payload - The analysis request payload
   * @param timeoutMs - Timeout in milliseconds
   * @returns Promise resolving to the response result, or rejecting with EngineUnavailableError
   * @throws EngineUnavailableError if no connection, timeout, or error response
   */
  request(userId: string, payload: unknown, timeoutMs: number): Promise<unknown> {
    const state = this.connections.get(userId);

    if (!state) {
      // Fail fast: no connection for this user
      return Promise.reject(new EngineUnavailableError(`No tunnel connection for user ${userId}`));
    }

    // Generate a unique request ID
    const requestId = randomUUID();

    // Create the message with requestId included in payload
    const message = JSON.stringify({
      requestId,
      ...(typeof payload === 'object' && payload !== null ? payload : {})
    });

    return new Promise((resolve, reject) => {
      // Set up the timeout (will reject if no response)
      const timeoutId = setTimeout(() => {
        // Remove the handler if it's still there
        state.requestHandlers.delete(requestId);
        reject(new EngineUnavailableError(`Tunnel request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Create the handler
      const handler: RequestHandler = {
        resolve,
        reject,
        timeoutId
      };

      // Store the handler
      state.requestHandlers.set(requestId, handler);

      // Send the message to the browser
      try {
        state.connection.send(message);
      } catch (err) {
        // If send fails, clean up and reject
        state.requestHandlers.delete(requestId);
        clearTimeout(timeoutId);
        reject(new EngineUnavailableError(`Failed to send tunnel request: ${err}`));
      }
    });
  }
}
