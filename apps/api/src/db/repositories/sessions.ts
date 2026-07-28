import type { Kysely } from 'kysely';
import type { Thread } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export type SessionStatus = 'active' | 'completed' | 'paused_no_credits';

export interface SessionRow {
  id: string;
  gameId: string;
  userId: string;
  status: SessionStatus;
  currentPly: number;
  summary: string | null;
  homework: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

const BASE_COLUMNS = [
  'id',
  'gameId',
  'userId',
  'status',
  'currentPly',
  'summary',
  'homework',
  'startedAt',
  'endedAt'
] as const;

export interface NewSession {
  gameId: string;
  userId: string;
}

export function insert(db: Kysely<Database>, values: NewSession): Promise<SessionRow> {
  return db
    .insertInto('sessions')
    .values({ ...values, status: 'active' })
    .returning(BASE_COLUMNS)
    .executeTakeFirstOrThrow();
}

export function findById(db: Kysely<Database>, id: string): Promise<SessionRow | undefined> {
  return db.selectFrom('sessions').select(BASE_COLUMNS).where('id', '=', id).executeTakeFirst();
}

export function findByIdForUser(
  db: Kysely<Database>,
  id: string,
  userId: string
): Promise<SessionRow | undefined> {
  return db
    .selectFrom('sessions')
    .select(BASE_COLUMNS)
    .where('id', '=', id)
    .where('userId', '=', userId)
    .executeTakeFirst();
}

export function markCompleted(db: Kysely<Database>, id: string): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ status: 'completed', endedAt: new Date() })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export function markPausedNoCredits(db: Kysely<Database>, id: string): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ status: 'paused_no_credits' })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export function updateCurrentPly(db: Kysely<Database>, id: string, ply: number): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ currentPly: ply })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export function storeSummary(
  db: Kysely<Database>,
  id: string,
  summary: string,
  homework: string | null
): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ summary, homework })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export function updateThreads(db: Kysely<Database>, id: string, threads: Thread[]): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ threads: JSON.stringify(threads) })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export async function getThreads(db: Kysely<Database>, id: string): Promise<Thread[]> {
  const row = await db.selectFrom('sessions').select('threads').where('id', '=', id).executeTakeFirst();
  return (row?.threads as Thread[] | undefined) ?? [];
}

export async function countByUser(db: Kysely<Database>, userId: string): Promise<number> {
  const result = await db
    .selectFrom('sessions')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('userId', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(result.count);
}
