import { MISTAKE_CATEGORIES } from '@chess-coach/shared';
import type { DashboardResponse } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as findingsRepo from '../db/repositories/findings.js';
import * as focusAreasRepo from '../db/repositories/focus-areas.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';

const LAST_5_GAMES = 5;
const LAST_20_GAMES = 20;
const SESSION_HISTORY_LIMIT = 20;

/** design.md §4.3: Progress dashboard — focus areas, mistake trends (last
 * 5/20 games), and session history. All aggregation SQL lives in the
 * repositories; this just combines their results into the response shape. */
export async function getDashboard(db: Kysely<Database>, userId: string): Promise<DashboardResponse> {
  const [active, resolved, last5Counts, last20Counts, sessionHistory] = await Promise.all([
    focusAreasRepo.listActiveAndImproving(db, userId),
    focusAreasRepo.listResolved(db, userId),
    findingsRepo.countByCategoryForRecentGames(db, userId, LAST_5_GAMES),
    findingsRepo.countByCategoryForRecentGames(db, userId, LAST_20_GAMES),
    sessionsRepo.listCompletedWithGameByUser(db, userId, SESSION_HISTORY_LIMIT)
  ]);

  return {
    focusAreas: {
      active: active.map(toFocusAreaSummary),
      resolved: resolved.map(toFocusAreaSummary)
    },
    mistakeTrends: MISTAKE_CATEGORIES.filter((category) => (last20Counts[category] ?? 0) > 0).map((category) => ({
      category,
      last5: last5Counts[category] ?? 0,
      last20: last20Counts[category] ?? 0
    })),
    sessionHistory: sessionHistory.map((row) => ({
      sessionId: row.sessionId,
      gameId: row.gameId,
      startedAt: row.startedAt.toISOString(),
      whiteName: row.whiteName,
      blackName: row.blackName,
      userColor: row.userColor,
      result: row.result,
      summary: row.summary,
      homework: row.homework
    }))
  };
}

function toFocusAreaSummary(row: focusAreasRepo.FocusAreaRow): DashboardResponse['focusAreas']['active'][number] {
  return {
    category: row.category,
    status: row.status,
    note: row.note,
    evidenceCount: row.evidenceCount,
    lastSeenAt: row.lastSeenAt.toISOString()
  };
}
