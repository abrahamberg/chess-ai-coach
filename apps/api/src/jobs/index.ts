import type { TaskList } from 'graphile-worker';
import { createAnalyzeGameTask, type AnalyzeGameTaskOptions } from './analyze-game.js';

export function createTaskList(options: AnalyzeGameTaskOptions): TaskList {
  return {
    'analyze-game': createAnalyzeGameTask(options)
  };
}

export * from './analyze-game.js';
export * from './queue.js';
