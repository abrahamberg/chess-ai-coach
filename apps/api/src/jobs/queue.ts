import { makeWorkerUtils, type WorkerUtils } from 'graphile-worker';

/** Job enqueueing, abstracted so routes don't depend on graphile-worker directly. */
export interface JobQueue {
  enqueueAnalyzeGame(gameId: string): Promise<void>;
}

export const noopJobQueue: JobQueue = {
  enqueueAnalyzeGame: () => Promise.resolve()
};

export interface GraphileJobQueueHandle {
  queue: JobQueue;
  close: () => Promise<void>;
}

/** Real `JobQueue`, backed by graphile-worker's job table (architecture: worker
 * runs `analyze-game` jobs from its own deployment; this is the enqueue side). */
export async function createGraphileJobQueue(connectionString: string): Promise<GraphileJobQueueHandle> {
  const workerUtils: WorkerUtils = await makeWorkerUtils({ connectionString });
  await workerUtils.migrate();

  return {
    queue: {
      enqueueAnalyzeGame: async (gameId: string) => {
        await workerUtils.addJob('analyze-game', { gameId });
      }
    },
    close: async () => {
      await workerUtils.release();
    }
  };
}
