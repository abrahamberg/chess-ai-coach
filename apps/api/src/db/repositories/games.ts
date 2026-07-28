import type { Kysely } from 'kysely';
import type { AnalysisStatus, GameSource, PlayerColor } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export interface GameRow {
  id: string;
  userId: string;
  pgn: string;
  source: GameSource;
  userColor: PlayerColor;
  whiteName: string | null;
  blackName: string | null;
  result: string | null;
  timeControl: string | null;
  eco: string | null;
  playedAt: Date | null;
  createdAt: Date;
}

export interface NewGame {
  userId: string;
  pgn: string;
  source: GameSource;
  userColor: PlayerColor;
  whiteName: string | null;
  blackName: string | null;
  result: string | null;
  timeControl: string | null;
  eco: string | null;
  playedAt: Date | null;
}

export function insert(db: Kysely<Database>, values: NewGame): Promise<GameRow> {
  return db.insertInto('games').values(values).returningAll().executeTakeFirstOrThrow();
}

export function listByUser(db: Kysely<Database>, userId: string): Promise<GameRow[]> {
  return db
    .selectFrom('games')
    .selectAll()
    .where('userId', '=', userId)
    .orderBy('createdAt', 'desc')
    .execute();
}

export interface GameListRow extends GameRow {
  analysisStatus: AnalysisStatus | null;
}

/** design.md §4.1: Games (home) list — each row needs its analysis status
 * for the status chip, so this left-joins the latest analysis per game. */
export function listByUserWithStatus(db: Kysely<Database>, userId: string): Promise<GameListRow[]> {
  return db
    .selectFrom('games')
    .leftJoin('analyses', 'analyses.gameId', 'games.id')
    .selectAll('games')
    .select('analyses.status as analysisStatus')
    .where('games.userId', '=', userId)
    .orderBy('games.createdAt', 'desc')
    .execute();
}

/** No user scoping — for worker/job code, which runs outside a request context. */
export function findById(db: Kysely<Database>, id: string): Promise<GameRow | undefined> {
  return db.selectFrom('games').selectAll().where('id', '=', id).executeTakeFirst();
}

export function findByIdForUser(
  db: Kysely<Database>,
  id: string,
  userId: string
): Promise<GameRow | undefined> {
  return db
    .selectFrom('games')
    .selectAll()
    .where('id', '=', id)
    .where('userId', '=', userId)
    .executeTakeFirst();
}

export async function countImportsSince(
  db: Kysely<Database>,
  userId: string,
  since: Date
): Promise<number> {
  const result = await db
    .selectFrom('games')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('userId', '=', userId)
    .where('createdAt', '>=', since)
    .executeTakeFirstOrThrow();
  return Number(result.count);
}
