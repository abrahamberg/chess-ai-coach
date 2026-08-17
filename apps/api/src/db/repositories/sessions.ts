import type { Kysely } from 'kysely';
import type { SessionMode, Thread } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export type SessionStatus = 'active' | 'completed' | 'paused_no_credits' | 'abandoned';

export interface SessionRow {
  id: string;
  gameId: string;
  userId: string;
  status: SessionStatus;
  mode: SessionMode;
  currentPly: number;
  /** What the conversation is actually about — see schema.ts's SessionsTable
   * doc comment. Equal to currentPly except mid-flashback. */
  subjectPly: number;
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
  'mode',
  'currentPly',
  'subjectPly',
  'summary',
  'homework',
  'startedAt',
  'endedAt'
] as const;

export interface NewSession {
  gameId: string;
  userId: string;
  /** Defaults to 'analyze' (today's only mode) when omitted. */
  mode?: SessionMode;
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

/** Game deletion cascade (services/games.ts deleteGameForUser): the session
 * ids to clear from session_messages/session_move_notes before the sessions
 * themselves (and the game) can be deleted. */
export async function listIdsByGameId(db: Kysely<Database>, gameId: string): Promise<string[]> {
  const rows = await db.selectFrom('sessions').select('id').where('gameId', '=', gameId).execute();
  return rows.map((row) => row.id);
}

export function deleteByGameId(db: Kysely<Database>, gameId: string): Promise<void> {
  return db.deleteFrom('sessions').where('gameId', '=', gameId).execute().then(() => undefined);
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

/** Moves only the board/analysis position — used for a flashback
 * show_position, which must NOT move subjectPly (that would incorrectly
 * shift the episode boundary — see coach-agent-client-tool-result.ts). */
export function updateCurrentPly(db: Kysely<Database>, id: string, ply: number): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ currentPly: ply })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

/** A genuine subject change — a subject-intent show_position, a student
 * clicking a position divider, a play-mode move committing, or an undo —
 * moves the board and the conversation's subject together, same as the
 * single currentPly did before subjectPly existed. */
export function updateSubjectAndCurrentPly(db: Kysely<Database>, id: string, ply: number): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ currentPly: ply, subjectPly: ply })
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

/** Latest-turn-only debug snapshot (coach debug mode design doc) — same
 * latest-state-on-the-row pattern as `threads`/`updateThreads` above, so it
 * works across pods and process restarts instead of the in-memory Map it
 * replaced. `snapshot` is an opaque JSON value to this layer; the caller
 * (coach-agent.ts) owns its shape. */
export function updateDebugSnapshot(db: Kysely<Database>, id: string, snapshot: unknown): Promise<void> {
  return db
    .updateTable('sessions')
    .set({ debugSnapshot: JSON.stringify(snapshot) })
    .where('id', '=', id)
    .execute()
    .then(() => undefined);
}

export async function getDebugSnapshot(db: Kysely<Database>, id: string): Promise<unknown> {
  const row = await db.selectFrom('sessions').select('debugSnapshot').where('id', '=', id).executeTakeFirst();
  return row?.debugSnapshot ?? undefined;
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
