import type { GameListResponse } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as gamesRepo from '../db/repositories/games.js';
import type { Database } from '../db/schema.js';

/** design.md §4.1: Games (home) list — one row per game with its analysis
 * status for the status chip. SQL lives in the repository only. */
export async function listGamesForUser(db: Kysely<Database>, userId: string): Promise<GameListResponse> {
  const rows = await gamesRepo.listByUserWithStatus(db, userId);
  return rows.map((row) => ({
    id: row.id,
    userColor: row.userColor,
    whiteName: row.whiteName,
    blackName: row.blackName,
    result: row.result,
    timeControl: row.timeControl,
    playedAt: row.playedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    analysisStatus: row.analysisStatus
  }));
}
