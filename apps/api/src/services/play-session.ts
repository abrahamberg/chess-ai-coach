import type { Kysely } from 'kysely';
import type { PlayerColor } from '@chess-coach/shared';
import * as gamesRepo from '../db/repositories/games.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { createSessionForGame } from './coach-agent-session.js';

/**
 * Starts a fresh live sparring game (architecture.md §14): a minimal,
 * header-only PGN that grows move by move as the game is played, paired
 * with a 'play'-mode session. Skips the whole analyses/credits-gate
 * pipeline entirely — there's no pre-game analysis to wait on, and the
 * student's live profile/focus areas are the coach's "prep" instead.
 */
export async function createPlaySession(
  db: Kysely<Database>,
  userId: string,
  studentColor: PlayerColor
): Promise<SessionRow> {
  const game = await gamesRepo.insert(db, {
    userId,
    pgn: '',
    source: 'coach_play',
    userColor: studentColor,
    whiteName: studentColor === 'white' ? 'You' : 'Coach',
    blackName: studentColor === 'black' ? 'You' : 'Coach',
    result: null,
    timeControl: null,
    eco: null,
    playedAt: new Date()
  });

  return createSessionForGame(db, { gameId: game.id, userId, mode: 'play' });
}
