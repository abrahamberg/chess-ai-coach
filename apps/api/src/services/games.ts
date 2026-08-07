import type { GameListResponse } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as gamesRepo from '../db/repositories/games.js';
import type { GameListRow } from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';

/** design.md §4.1 / architecture §14: Games (home) list — one row per game
 * with its analysis status for the status chip, or (for a play-mode game)
 * its still-resumable session id so the row can link straight back into an
 * in-progress game instead of showing a stuck "analyzing…" chip — a
 * coach_play game never gets an `analyses` row, so analysisStatus is always
 * null for it. SQL lives in the repository only. */
export async function listGamesForUser(db: Kysely<Database>, userId: string): Promise<GameListResponse> {
  const rows = await gamesRepo.listByUserWithStatus(db, userId);
  return Promise.all(rows.map((row) => toListItem(db, userId, row)));
}

async function toListItem(db: Kysely<Database>, userId: string, row: GameListRow) {
  const sessionId =
    row.source === 'coach_play' ? ((await sessionsRepo.findActiveByGameIdForUser(db, row.id, userId))?.id ?? null) : null;
  return {
    id: row.id,
    source: row.source,
    userColor: row.userColor,
    whiteName: row.whiteName,
    blackName: row.blackName,
    result: row.result,
    timeControl: row.timeControl,
    playedAt: row.playedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    analysisStatus: row.analysisStatus,
    sessionId
  };
}
