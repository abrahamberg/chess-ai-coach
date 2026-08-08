import type { TaskList } from 'graphile-worker';
import { createAnalyzeGameTask, type AnalyzeGameTaskOptions } from './analyze-game.js';
import { createDeepenAnalysisTask } from './deepen-analysis.js';
import { createPrunePositionEvaluationsTask, type PrunePositionEvaluationsTaskOptions } from './prune-position-evaluations.js';
import { createSummarizeSessionTask } from './summarize-session.js';

export type TaskListOptions = AnalyzeGameTaskOptions & PrunePositionEvaluationsTaskOptions;

export function createTaskList(options: TaskListOptions): TaskList {
  return {
    'analyze-game': createAnalyzeGameTask(options),
    'deepen-analysis': createDeepenAnalysisTask(options),
    'prune-position-evaluations': createPrunePositionEvaluationsTask(options),
    'summarize-session': createSummarizeSessionTask(options)
  };
}

export * from './analyze-game.js';
export * from './deepen-analysis.js';
export * from './prune-position-evaluations.js';
export * from './queue.js';
export * from './summarize-session.js';
