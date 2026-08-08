import { SharedEngineWorker, type SharedEngineWorkerOptions } from './shared-engine-worker.js';

let instance: SharedEngineWorker | null = null;

/** One SharedEngineWorker for the whole app (see SharedEngineWorker's doc
 * comment). Tests that need an isolated fake worker should call
 * resetSharedEngineWorkerForTests() in beforeEach/afterEach. */
export function getSharedEngineWorker(options?: SharedEngineWorkerOptions): SharedEngineWorker {
  if (!instance) instance = new SharedEngineWorker(options);
  return instance;
}

export function resetSharedEngineWorkerForTests(): void {
  instance = null;
}
