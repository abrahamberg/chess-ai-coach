import type { Kysely } from 'kysely';
import type { RatingBand } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  ratingBand: RatingBand;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  selfAssessment: string | null;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  displayName: string;
}

export interface UserPatch {
  ratingBand?: RatingBand;
  lichessUsername?: string | null;
  chesscomUsername?: string | null;
  selfAssessment?: string | null;
}

export function findByEmail(db: Kysely<Database>, email: string): Promise<UserRow | undefined> {
  return db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
}

export function findById(db: Kysely<Database>, id: string): Promise<UserRow | undefined> {
  return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
}

export function insert(db: Kysely<Database>, values: NewUser): Promise<UserRow> {
  return db.insertInto('users').values(values).returningAll().executeTakeFirstOrThrow();
}

export function update(db: Kysely<Database>, id: string, patch: UserPatch): Promise<UserRow> {
  if (Object.keys(patch).length === 0) {
    return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }
  return db
    .updateTable('users')
    .set(patch)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
}
