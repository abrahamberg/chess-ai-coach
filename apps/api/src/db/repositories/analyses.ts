import type { Kysely } from 'kysely';
import type { AnalysisStatus } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export interface AnalysisRow {
  id: string;
  gameId: string;
  status: AnalysisStatus;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export function insertQueued(db: Kysely<Database>, gameId: string): Promise<AnalysisRow> {
  return db
    .insertInto('analyses')
    .values({ gameId, status: 'queued' })
    .returning(['id', 'gameId', 'status', 'error', 'createdAt', 'completedAt'])
    .executeTakeFirstOrThrow();
}

export function findByGameId(
  db: Kysely<Database>,
  gameId: string
): Promise<AnalysisRow | undefined> {
  return db
    .selectFrom('analyses')
    .select(['id', 'gameId', 'status', 'error', 'createdAt', 'completedAt'])
    .where('gameId', '=', gameId)
    .executeTakeFirst();
}
