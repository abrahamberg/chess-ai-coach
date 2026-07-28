import type { Kysely } from 'kysely';
import type { MistakeCategory } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export type FocusAreaStatus = 'active' | 'improving' | 'resolved';

export interface FocusAreaRow {
  id: string;
  userId: string;
  category: MistakeCategory;
  status: FocusAreaStatus;
  note: string;
  evidenceCount: number;
  lastSeenAt: Date;
  createdAt: Date;
}

export function findByUserAndCategory(
  db: Kysely<Database>,
  userId: string,
  category: MistakeCategory
): Promise<FocusAreaRow | undefined> {
  return db
    .selectFrom('focusAreas')
    .selectAll()
    .where('userId', '=', userId)
    .where('category', '=', category)
    .executeTakeFirst();
}

export async function countActiveByUser(db: Kysely<Database>, userId: string): Promise<number> {
  const result = await db
    .selectFrom('focusAreas')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('userId', '=', userId)
    .where('status', '=', 'active')
    .executeTakeFirstOrThrow();
  return Number(result.count);
}

export interface NewFocusArea {
  userId: string;
  category: MistakeCategory;
  status: FocusAreaStatus;
  note: string;
}

export function insert(db: Kysely<Database>, values: NewFocusArea): Promise<FocusAreaRow> {
  return db.insertInto('focusAreas').values(values).returningAll().executeTakeFirstOrThrow();
}

export function updateStatusAndNote(
  db: Kysely<Database>,
  id: string,
  status: FocusAreaStatus,
  note: string
): Promise<FocusAreaRow> {
  return db
    .updateTable('focusAreas')
    .set((eb) => ({
      status,
      note,
      lastSeenAt: new Date(),
      evidenceCount: eb('evidenceCount', '+', 1)
    }))
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Active + improving areas — what the coach's system prompt and get_user_profile show. */
export function listActiveAndImproving(
  db: Kysely<Database>,
  userId: string
): Promise<FocusAreaRow[]> {
  return db
    .selectFrom('focusAreas')
    .selectAll()
    .where('userId', '=', userId)
    .where('status', 'in', ['active', 'improving'])
    .orderBy('lastSeenAt', 'desc')
    .execute();
}

/** design.md §4.3: the dashboard's "Resolved ✓" history accordion. */
export function listResolved(db: Kysely<Database>, userId: string): Promise<FocusAreaRow[]> {
  return db
    .selectFrom('focusAreas')
    .selectAll()
    .where('userId', '=', userId)
    .where('status', '=', 'resolved')
    .orderBy('lastSeenAt', 'desc')
    .execute();
}
