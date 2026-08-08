/**
 * EngineTunnelTransport sends correlated requests over a WebSocket tunnel
 * to browser-connected clients and waits for matched responses.
 *
 * Used by BrowserTunnelEngineBackend (Task 9) to send analysis requests
 * to browser tunnels and receive results. The transport handles all
 * request/response correlation, timeout, and error handling.
 */
export interface EngineTunnelTransport {
  /**
   * Send a request to a browser-connected client and wait for a response.
   *
   * Generates a random requestId, sends the payload with that id to the
   * connection, and waits for a response with the same requestId. If no
   * response arrives within timeoutMs, rejects with EngineUnavailableError.
   * If the connection is not registered for this userId, throws immediately.
   *
   * @param userId - The user ID whose browser connection should receive the request
   * @param payload - The analysis request payload (e.g., { fen, depth, multiPv })
   * @param timeoutMs - Timeout in milliseconds; no fallback if exceeded
   * @returns Promise resolving to the response result field, or rejecting with EngineUnavailableError
   * @throws EngineUnavailableError if userId has no connection, timeout expires, or error field is present
   */
  request(userId: string, payload: unknown, timeoutMs: number): Promise<unknown>;
}
