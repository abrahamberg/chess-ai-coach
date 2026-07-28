import type { TaskList } from 'graphile-worker';
import { createAnalyzeGameTask, type AnalyzeGameTaskOptions } from './analyze-game.js';
import { createSummarizeSessionTask } from './summarize-session.js';

export type TaskListOptions = AnalyzeGameTaskOptions;

export function createTaskList(options: TaskListOptions): TaskList {
  return {
    'analyze-game': createAnalyzeGameTask(options),
    'summarize-session': createSummarizeSessionTask(options)
  };
}

export * from './analyze-game.js';
export * from './queue.js';
export * from './summarize-session.js';
