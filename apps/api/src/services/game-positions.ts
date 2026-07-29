import { parsePgn, type ParsedPosition } from '@chess-coach/chess-analysis';
import type { Kysely } from 'kysely';
import * as gamesRepo from '../db/repositories/games.js';
import type { Database } from '../db/schema.js';

/**
 * Authoritative ply -> position lookup, replayed straight from the game's
 * stored PGN. This is the coach agent's only source of ground truth for a
 * position's FEN — the coach itself is never trusted to reconstruct one from
 * memory (see coach-agent.ts's show_position augmentation and coach-tools.ts's
 * check_position tool).
 */
export async function getPositionAtPly(
  db: Kysely<Database>,
  gameId: string,
  ply: number
): Promise<ParsedPosition | undefined> {
  const game = await gamesRepo.findById(db, gameId);
  if (!game) return undefined;
  return parsePgn(game.pgn).positions[ply];
}
