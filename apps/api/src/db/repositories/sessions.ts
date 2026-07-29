import type { Kysely } from 'kysely';
import type { Thread } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export type SessionStatus = 'active' | 'completed' | 'paused_no_credits' | 'abandoned';

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

/** The most recent still-resumable session for a game — 'active' or
 * 'paused_no_credits', never 'completed'/'abandoned'. Used to make the Games
 * page link back into an ongoing session instead of starting a new one. */
export function findActiveByGameIdForUser(
  db: Kysely<Database>,
  gameId: string,
  userId: string
): Promise<SessionRow | undefined> {
  return db
    .selectFrom('sessions')
    .select(BASE_COLUMNS)
    .where('gameId', '=', gameId)
    .where('userId', '=', userId)
    .where('status', 'in', ['active', 'paused_no_credits'])
    .orderBy('startedAt', 'desc')
    .limit(1)
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

/** Student-initiated reset (as opposed to the coach's own end_session) — see
 * migration 0004_session_abandoned_status. */
export function markAbandoned(db: Kysely<Database>, id: string): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ status: 'abandoned', endedAt: new Date() })
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

export interface CompletedSessionWithGame {
  sessionId: string;
  gameId: string;
  startedAt: Date;
  summary: string | null;
  homework: string | null;
  whiteName: string | null;
  blackName: string | null;
  userColor: 'white' | 'black';
  result: string | null;
}

/** design.md §4.3: dashboard session-history list — SQL join lives here, not
 * in the service (AGENTS.md rule: SQL in repositories only). */
export function listCompletedWithGameByUser(
  db: Kysely<Database>,
  userId: string,
  limit: number
): Promise<CompletedSessionWithGame[]> {
  return db
    .selectFrom('sessions')
    .innerJoin('games', 'games.id', 'sessions.gameId')
    .select([
      'sessions.id as sessionId',
      'sessions.gameId',
      'sessions.startedAt',
      'sessions.summary',
      'sessions.homework',
      'games.whiteName',
      'games.blackName',
      'games.userColor',
      'games.result'
    ])
    .where('sessions.userId', '=', userId)
    .where('sessions.status', '=', 'completed')
    .orderBy('sessions.startedAt', 'desc')
    .limit(limit)
    .execute();
}

export async function countByUser(db: Kysely<Database>, userId: string): Promise<number> {
  const result = await db
    .selectFrom('sessions')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('userId', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(result.count);
}
