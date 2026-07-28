import type { Kysely } from 'kysely';
import type { MistakeCategory } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export type FindingSeverity = 'minor' | 'significant' | 'critical';

export interface FindingRow {
  id: string;
  userId: string;
  sessionId: string | null;
  gameId: string | null;
  category: MistakeCategory;
  severity: FindingSeverity;
  ply: number | null;
  description: string;
  isPositive: boolean;
  createdAt: Date;
}

export interface NewFinding {
  userId: string;
  sessionId: string | null;
  gameId: string | null;
  category: MistakeCategory;
  severity: FindingSeverity;
  ply: number | null;
  description: string;
  isPositive: boolean;
}

export function insert(db: Kysely<Database>, values: NewFinding): Promise<FindingRow> {
  return db.insertInto('findings').values(values).returningAll().executeTakeFirstOrThrow();
}

export function listRecentByUser(
  db: Kysely<Database>,
  userId: string,
  limit: number
): Promise<FindingRow[]> {
  return db
    .selectFrom('findings')
    .selectAll()
    .where('userId', '=', userId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .execute();
}

/** Finding counts by category, scoped to the user's most recent `gameLimit` games
 * (get_user_profile's "per-category counts (last 20 games)", architecture §7.1). */
export async function countByCategoryForRecentGames(
  db: Kysely<Database>,
  userId: string,
  gameLimit: number
): Promise<Record<string, number>> {
  const recentGameIds = db
    .selectFrom('games')
    .select('id')
    .where('userId', '=', userId)
    .orderBy('createdAt', 'desc')
    .limit(gameLimit);

  const rows = await db
    .selectFrom('findings')
    .select(['category', (eb) => eb.fn.countAll<number>().as('count')])
    .where('userId', '=', userId)
    .where('gameId', 'in', recentGameIds)
    .groupBy('category')
    .execute();

  return Object.fromEntries(rows.map((row) => [row.category, Number(row.count)]));
}
