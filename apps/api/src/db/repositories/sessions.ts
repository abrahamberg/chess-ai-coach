import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export type SessionStatus = 'active' | 'completed' | 'paused_no_credits';

export interface SessionRow {
  id: string;
  gameId: string;
  userId: string;
  status: SessionStatus;
  currentPly: number;
  startedAt: Date;
  endedAt: Date | null;
}

const BASE_COLUMNS = ['id', 'gameId', 'userId', 'status', 'currentPly', 'startedAt', 'endedAt'] as const;

export function findById(db: Kysely<Database>, id: string): Promise<SessionRow | undefined> {
  return db.selectFrom('sessions').select(BASE_COLUMNS).where('id', '=', id).executeTakeFirst();
}

export function markCompleted(db: Kysely<Database>, id: string): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ status: 'completed', endedAt: new Date() })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export async function countByUser(db: Kysely<Database>, userId: string): Promise<number> {
  const result = await db
    .selectFrom('sessions')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('userId', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(result.count);
}
