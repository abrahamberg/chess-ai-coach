import { detectUserColor, parsePgn, type Usernames } from '@chess-coach/chess-analysis';
import type { ImportGameRequest, PlayerColor } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { RateLimitError } from '../lib/errors.js';
import type { JobQueue } from '../jobs/queue.js';

export { InvalidPgnError } from '@chess-coach/chess-analysis';

export class MissingUserColorError extends Error {
  constructor() {
    super('Could not determine which side is the user; pass userColor explicitly.');
  }
}

const DAILY_IMPORT_LIMIT = 10;

export interface ImportGameResult {
  gameId: string;
  analysisId: string;
}

export async function importGame(
  db: Kysely<Database>,
  jobQueue: JobQueue,
  userId: string,
  usernames: Usernames,
  request: ImportGameRequest
): Promise<ImportGameResult> {
  await assertUnderDailyLimit(db, userId);

  const parsed = parsePgn(request.pgn);
  const userColor = request.userColor ?? detectUserColor(parsed.headers, usernames) ?? undefined;
  if (!userColor) throw new MissingUserColorError();

  await learnPlatformUsername(db, userId, request.source, parsed.headers, usernames, userColor);

  const game = await gamesRepo.insert(db, {
    userId,
    pgn: request.pgn,
    source: request.source,
    userColor,
    whiteName: parsed.headers['White'] ?? null,
    blackName: parsed.headers['Black'] ?? null,
    result: parsed.headers['Result'] ?? null,
    timeControl: parsed.headers['TimeControl'] ?? null,
    eco: parsed.headers['ECO'] ?? null,
    playedAt: parsePlayedAt(parsed.headers)
  });

  const analysis = await analysesRepo.insertQueued(db, game.id);
  await jobQueue.enqueueAnalyzeGame(game.id);

  return { gameId: game.id, analysisId: analysis.id };
}

/** Once a game's side is known, remembers the student's username on whichever
 * platform the PGN came from — so detectUserColor can auto-resolve future
 * imports from that platform without the client falling back to ColorConfirm's
 * "which side were you" prompt. Only fills in a platform username that isn't
 * already on file; never overwrites one the student (or a prior scan) already
 * set, and never fires for a 'paste'/'upload' PGN with no recognizable
 * Lichess/Chess.com Site header. */
async function learnPlatformUsername(
  db: Kysely<Database>,
  userId: string,
  source: ImportGameRequest['source'],
  headers: Record<string, string>,
  usernames: Usernames,
  userColor: PlayerColor
): Promise<void> {
  const platform = detectPlatform(source, headers);
  if (!platform) return;

  const alreadyKnown = platform === 'lichess' ? usernames.lichess : usernames.chesscom;
  if (alreadyKnown) return;

  const observedUsername = headers[userColor === 'white' ? 'White' : 'Black'];
  if (!observedUsername) return;

  await usersRepo.update(
    db,
    userId,
    platform === 'lichess' ? { lichessUsername: observedUsername } : { chesscomUsername: observedUsername }
  );
}

function detectPlatform(
  source: ImportGameRequest['source'],
  headers: Record<string, string>
): 'lichess' | 'chesscom' | null {
  if (source === 'lichess') return 'lichess';
  const site = headers['Site']?.toLowerCase() ?? '';
  if (site.includes('lichess.org')) return 'lichess';
  if (site.includes('chess.com')) return 'chesscom';
  return null;
}

async function assertUnderDailyLimit(db: Kysely<Database>, userId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await gamesRepo.countImportsSince(db, userId, since);
  if (count >= DAILY_IMPORT_LIMIT) {
    throw new RateLimitError('Import limit reached (10 games/day)');
  }
}

/** Parses a PGN `Date`/`UTCDate` header (strict "YYYY.MM.DD"); anything else
 * (missing, partial like "2024.??.??") is treated as unknown. */
function parsePlayedAt(headers: Record<string, string>): Date | null {
  const raw = headers['UTCDate'] ?? headers['Date'];
  if (!raw || !/^\d{4}\.\d{2}\.\d{2}$/.test(raw)) return null;
  const iso = raw.replaceAll('.', '-');
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
