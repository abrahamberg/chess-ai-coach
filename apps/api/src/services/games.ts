import type { GameListResponse } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as findingsRepo from '../db/repositories/findings.js';
import * as gameMoveQualitiesRepo from '../db/repositories/game-move-qualities.js';
import * as gamesRepo from '../db/repositories/games.js';
import type { GameListRow } from '../db/repositories/games.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';

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

/** Deletes a game and everything that hangs off it — none of the foreign
 * keys involved are ON DELETE CASCADE (see migrations 0001/0006/0010), so
 * dependents must go first: session_messages/session_move_notes for each of
 * the game's sessions, then sessions, then findings/game_move_qualities/
 * analyses, then the game itself. Wrapped in a transaction so a mid-cascade
 * failure can't leave orphaned rows. */
export async function deleteGameForUser(db: Kysely<Database>, gameId: string, userId: string): Promise<void> {
  const game = await gamesRepo.findByIdForUser(db, gameId, userId);
  if (!game) throw new NotFoundError('Game not found');

  await db.transaction().execute(async (trx) => {
    const sessionIds = await sessionsRepo.listIdsByGameId(trx, gameId);
    for (const sessionId of sessionIds) {
      await sessionMessagesRepo.deleteBySessionId(trx, sessionId);
      await sessionMoveNotesRepo.deleteBySessionId(trx, sessionId);
    }
    await sessionsRepo.deleteByGameId(trx, gameId);
    await findingsRepo.deleteByGameId(trx, gameId);
    await gameMoveQualitiesRepo.deleteByGameId(trx, gameId);
    await analysesRepo.deleteByGameId(trx, gameId);
    await gamesRepo.remove(trx, gameId);
  });
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
