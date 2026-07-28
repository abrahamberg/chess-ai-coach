import { parsePgn } from '@chess-coach/chess-analysis';
import type { LichessRecentGame } from '@chess-coach/shared';

const RECENT_GAMES_LIMIT = 20;

interface LichessNdjsonGame {
  id: string;
  createdAt?: number;
  pgn?: string;
  players?: {
    white?: { user?: { name?: string } };
    black?: { user?: { name?: string } };
  };
}

export interface LichessClient {
  fetchRecentGames(username: string): Promise<LichessRecentGame[]>;
}

export class LichessApiError extends Error {
  constructor(status: number) {
    super(`Lichess API request failed with status ${status}`);
  }
}

/** Task 7.1: `GET /api/lichess/recent-games` — wraps Lichess's ndjson games
 * export. `fetchImpl` is injectable so the HTTP call is unit-testable
 * without hitting the real API. */
export function createLichessClient(fetchImpl: typeof fetch = fetch): LichessClient {
  return {
    async fetchRecentGames(username: string): Promise<LichessRecentGame[]> {
      const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${RECENT_GAMES_LIMIT}&pgnInJson=true`;
      const response = await fetchImpl(url, { headers: { Accept: 'application/x-ndjson' } });
      if (!response.ok) throw new LichessApiError(response.status);

      const text = await response.text();
      return text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => toRecentGame(JSON.parse(line) as LichessNdjsonGame));
    }
  };
}

function toRecentGame(raw: LichessNdjsonGame): LichessRecentGame {
  const headers = raw.pgn ? parsePgn(raw.pgn).headers : {};
  return {
    id: raw.id,
    pgn: raw.pgn ?? '',
    whiteName: headers['White'] ?? raw.players?.white?.user?.name ?? null,
    blackName: headers['Black'] ?? raw.players?.black?.user?.name ?? null,
    result: headers['Result'] ?? null,
    timeControl: headers['TimeControl'] ?? null,
    playedAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : null
  };
}
