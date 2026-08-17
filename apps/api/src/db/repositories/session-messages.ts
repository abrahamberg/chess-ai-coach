import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export type SessionMessageRole = 'user' | 'assistant' | 'tool';

export interface SessionMessageRow {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: unknown;
  ply: number | null;
  createdAt: Date;
}

export function insert(
  db: Kysely<Database>,
  sessionId: string,
  role: SessionMessageRole,
  content: unknown,
  ply: number | null = null
): Promise<SessionMessageRow> {
  return db
    .insertInto('sessionMessages')
    .values({ sessionId, role, content: JSON.stringify(content), ply })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Append-only replay order (architecture §8.1 — never mutate, never reorder). */
export function listBySession(db: Kysely<Database>, sessionId: string): Promise<SessionMessageRow[]> {
  return db
    .selectFrom('sessionMessages')
    .selectAll()
    .where('sessionId', '=', sessionId)
    .orderBy('id', 'asc')
    .execute();
}

/** Game deletion cascade (services/games.ts deleteGameForUser). */
export function deleteBySessionId(db: Kysely<Database>, sessionId: string): Promise<void> {
  return db.deleteFrom('sessionMessages').where('sessionId', '=', sessionId).execute().then(() => undefined);
}

/** recall_move tool (design doc §4): the raw transcript for one specific
 * past episode, excluding whatever's currently open. */
export function listBySessionAndPly(
  db: Kysely<Database>,
  sessionId: string,
  ply: number
): Promise<SessionMessageRow[]> {
  return db
    .selectFrom('sessionMessages')
    .selectAll()
    .where('sessionId', '=', sessionId)
    .where('ply', '=', ply)
    .orderBy('id', 'asc')
    .execute();
}
