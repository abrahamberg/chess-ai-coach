import type { ClassifiedMove } from '@chess-coach/chess-analysis';
import { sql, type Kysely } from 'kysely';
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

export interface AnalysisProgressRow {
  status: AnalysisStatus;
  /** Engine evals persisted so far. services/analysis.ts stores them a chunk
   * at a time, so this climbs through the `engine_running` step. */
  progress: number;
}

/** For the status SSE, which re-reads this row every second while a game
 * analyzes: counts the stored evals in Postgres instead of shipping the whole
 * `engine_evals` document back on each poll just to measure its length.
 * Raw SQL because `engine_evals` isn't on AnalysisRow, and the column is
 * spelled snake_case here since CamelCasePlugin doesn't rewrite sql``. */
export async function findProgress(
  db: Kysely<Database>,
  id: string
): Promise<AnalysisProgressRow | undefined> {
  const result = await sql<AnalysisProgressRow>`
    select status, coalesce(jsonb_array_length(engine_evals), 0)::int as progress
    from analyses
    where id = ${id}
  `.execute(db);
  return result.rows[0];
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

export function storeClassifiedMoves(
  db: Kysely<Database>,
  id: string,
  moves: ClassifiedMove[]
): Promise<void> {
  return db
    .updateTable('analyses')
    .set({ classifiedMoves: JSON.stringify(moves) })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

/** Reads back the stored per-move classification for a ready analysis (move
 * explorer color-coding). */
export function findClassifiedMovesByGameId(
  db: Kysely<Database>,
  gameId: string
): Promise<ClassifiedMove[] | undefined> {
  return db
    .selectFrom('analyses')
    .select('classifiedMoves')
    .where('gameId', '=', gameId)
    .executeTakeFirst()
    .then((row) => row?.classifiedMoves as ClassifiedMove[] | undefined);
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
