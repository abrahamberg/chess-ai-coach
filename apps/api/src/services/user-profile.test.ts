import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { applyFocusAreaUpdate, recordFinding } from './progress.js';
import { getProfileSummary } from './user-profile.js';

describe('getProfileSummary', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  test('returns empty-state defaults for a brand-new user', async () => {
    const user = await usersRepo.insert(db, { email: 'new@example.com', displayName: 'New' });

    const summary = await getProfileSummary(db, user.id);

    expect(summary.focusAreas).toEqual([]);
    expect(summary.recentFindings).toEqual([]);
    expect(summary.findingCounts).toEqual({});
    expect(summary.sessionCount).toBe(0);
  });

  test('aggregates active focus areas, recent findings, and session count', async () => {
    const user = await usersRepo.insert(db, { email: 'busy@example.com', displayName: 'Busy' });
    await applyFocusAreaUpdate(db, user.id, {
      category: 'hanging_piece',
      action: 'create',
      note: 'checks captures too slowly'
    });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: '1. e4 e5',
      source: 'paste',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    await recordFinding(db, user.id, null, game.id, {
      category: 'hanging_piece',
      severity: 'significant',
      ply: 12,
      description: 'Hung a knight.',
      isPositive: false
    });
    await db
      .insertInto('sessions')
      .values({ gameId: game.id, userId: user.id, status: 'completed' })
      .execute();

    const summary = await getProfileSummary(db, user.id);

    expect(summary.focusAreas).toHaveLength(1);
    expect(summary.focusAreas[0]?.category).toBe('hanging_piece');
    expect(summary.recentFindings).toHaveLength(1);
    expect(summary.findingCounts.hanging_piece).toBe(1);
    expect(summary.sessionCount).toBe(1);
  });
});
