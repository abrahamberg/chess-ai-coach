import type { Kysely } from 'kysely';
import type { AnalysisStatus, CoachingPlan, EngineEval } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export interface AnalysisRow {
  id: string;
  gameId: string;
  status: AnalysisStatus;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

const BASE_COLUMNS = ['id', 'gameId', 'status', 'error', 'createdAt', 'completedAt'] as const;

export function insertQueued(db: Kysely<Database>, gameId: string): Promise<AnalysisRow> {
  return db
    .insertInto('analyses')
    .values({ gameId, status: 'queued' })
    .returning(BASE_COLUMNS)
    .executeTakeFirstOrThrow();
}

export function findByGameId(
  db: Kysely<Database>,
  gameId: string
): Promise<AnalysisRow | undefined> {
  return db
    .selectFrom('analyses')
    .select(BASE_COLUMNS)
    .where('gameId', '=', gameId)
    .executeTakeFirst();
}

export function findById(db: Kysely<Database>, id: string): Promise<AnalysisRow | undefined> {
  return db.selectFrom('analyses').select(BASE_COLUMNS).where('id', '=', id).executeTakeFirst();
}

/** Scoped by game ownership — for the status route, which runs in a request context. */
export function findByIdForUser(
  db: Kysely<Database>,
  id: string,
  userId: string
): Promise<AnalysisRow | undefined> {
  return db
    .selectFrom('analyses')
    .innerJoin('games', 'games.id', 'analyses.gameId')
    .select([
      'analyses.id',
      'analyses.gameId',
      'analyses.status',
      'analyses.error',
      'analyses.createdAt',
      'analyses.completedAt'
    ])
    .where('analyses.id', '=', id)
    .where('games.userId', '=', userId)
    .executeTakeFirst();
}

export function updateStatus(
  db: Kysely<Database>,
  id: string,
  status: AnalysisStatus
): Promise<void> {
  return db
    .updateTable('analyses')
    .set({ status })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export function storeEngineEvals(
  db: Kysely<Database>,
  id: string,
  evals: EngineEval[]
): Promise<void> {
  return db
    .updateTable('analyses')
    .set({ engineEvals: JSON.stringify(evals) })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export function markReady(
  db: Kysely<Database>,
  id: string,
  coachingPlan: CoachingPlan
): Promise<void> {
  return db
    .updateTable('analyses')
    .set({ status: 'ready', coachingPlan: JSON.stringify(coachingPlan), completedAt: new Date() })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

/** Reads back the stored coaching plan for a ready analysis (coach system prompt). */
export function findCoachingPlanByGameId(
  db: Kysely<Database>,
  gameId: string
): Promise<CoachingPlan | undefined> {
  return db
    .selectFrom('analyses')
    .select('coachingPlan')
    .where('gameId', '=', gameId)
    .executeTakeFirst()
    .then((row) => row?.coachingPlan as CoachingPlan | undefined);
}

export function markFailed(db: Kysely<Database>, id: string, error: string): Promise<void> {
  return db
    .updateTable('analyses')
    .set({ status: 'failed', error, completedAt: new Date() })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}
