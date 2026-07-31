import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export interface SessionMoveNoteRow {
  id: string;
  sessionId: string;
  ply: number;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Upsert-wins semantics keyed on (sessionId, ply) — same full-replace
 * philosophy as update_threads: whichever write happens last for a ply
 * wins, whether that's the coach's record_move_note or the automatic
 * episode-close fallback (design doc §3). */
export function upsert(
  db: Kysely<Database>,
  sessionId: string,
  ply: number,
  note: string
): Promise<SessionMoveNoteRow> {
  return db
    .insertInto('sessionMoveNotes')
    .values({ sessionId, ply, note })
    .onConflict((oc) => oc.columns(['sessionId', 'ply']).doUpdateSet({ note, updatedAt: new Date() }))
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findByPly(
  db: Kysely<Database>,
  sessionId: string,
  ply: number
): Promise<SessionMoveNoteRow | undefined> {
  return db
    .selectFrom('sessionMoveNotes')
    .selectAll()
    .where('sessionId', '=', sessionId)
    .where('ply', '=', ply)
    .executeTakeFirst();
}

/** Other-moves-summary layer (design doc §5): every discussed ply except
 * the one currently open, oldest first. */
export function listOtherPlies(
  db: Kysely<Database>,
  sessionId: string,
  currentPly: number
): Promise<SessionMoveNoteRow[]> {
  return db
    .selectFrom('sessionMoveNotes')
    .selectAll()
    .where('sessionId', '=', sessionId)
    .where('ply', '!=', currentPly)
    .orderBy('ply', 'asc')
    .execute();
}
