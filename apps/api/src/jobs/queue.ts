/** Job enqueueing, abstracted so routes don't depend on graphile-worker directly.
 * A real queue is wired up in Phase 4; until then, callers inject a test double. */
export interface JobQueue {
  enqueueAnalyzeGame(gameId: string): Promise<void>;
}

export const noopJobQueue: JobQueue = {
  enqueueAnalyzeGame: () => Promise.resolve()
};
