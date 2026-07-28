export interface KeyedLock {
  /** Resolves once every earlier acquire() for the same key has released.
   * Call the returned function to release and let the next waiter proceed. */
  acquire(key: string): Promise<() => void>;
}

/** architecture §7.2: startTurn's client-tool round-trip (a new HTTP request
 * fired the instant the tool-call streams to the client) must never read a
 * session's message history until the turn that produced it has finished
 * persisting — otherwise the tool-result can land before its own tool-call,
 * corrupting replay order (seen live: OpenAI 400s on that session forever
 * after). One lock per session id serializes startTurn calls for that session. */
export function createKeyedLock(): KeyedLock {
  const tail = new Map<string, Promise<void>>();

  return {
    async acquire(key: string): Promise<() => void> {
      const prior = tail.get(key) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      tail.set(key, prior.then(() => held));
      await prior;
      return release;
    }
  };
}
