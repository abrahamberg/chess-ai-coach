import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export type SessionMessageRole = 'user' | 'assistant' | 'tool';

export interface SessionMessageRow {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: unknown;
  createdAt: Date;
}

export function insert(
  db: Kysely<Database>,
  sessionId: string,
  role: SessionMessageRole,
  content: unknown
): Promise<SessionMessageRow> {
  return db
    .insertInto('sessionMessages')
    .values({ sessionId, role, content: JSON.stringify(content) })
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
