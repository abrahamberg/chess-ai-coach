import type { Task } from 'graphile-worker';
import type { Kysely } from 'kysely';
import * as positionEvaluationsRepo from '../db/repositories/position-evaluations.js';
import type { Database } from '../db/schema.js';

export interface PrunePositionEvaluationsTaskOptions {
  db: Kysely<Database>;
  /** Row cap for position_evaluations (POSITION_EVAL_CACHE_MAX_ROWS). */
  maxRows: number;
  /** Age floor in days below which a row is never eviction-eligible, even
   * over cap (POSITION_EVAL_CACHE_MIN_AGE_DAYS). */
  minAgeDays: number;
}

/** graphile-worker Task, scheduled daily via worker.ts's crontab option
 * ('0 3 * * * prune-position-evaluations'): bounds position_evaluations'
 * unbounded growth by evicting the least-recently-accessed rows past the age
 * floor once the table exceeds maxRows. See repositories/position-evaluations.ts's
 * pruneOverCap for the eviction SQL and its trust/LRU semantics. */
export function createPrunePositionEvaluationsTask(options: PrunePositionEvaluationsTaskOptions): Task {
  return async () => {
    const deleted = await positionEvaluationsRepo.pruneOverCap(options.db, {
      maxRows: options.maxRows,
      minAgeDays: options.minAgeDays
    });
    console.log(`prune-position-evaluations: deleted ${deleted} row(s)`);
  };
}
