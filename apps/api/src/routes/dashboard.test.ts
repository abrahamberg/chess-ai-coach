import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { applyFocusAreaUpdate, recordFinding } from '../services/progress.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';

describe('GET /api/users/me/dashboard', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedGame(userId: string, overrides: Partial<Parameters<typeof gamesRepo.insert>[1]> = {}) {
    return gamesRepo.insert(db, {
      userId,
      pgn: '1. e4 e5',
      source: 'paste',
      userColor: 'white',
      whiteName: 'daniel',
      blackName: 'Marta',
      result: '1-0',
      timeControl: null,
      eco: null,
      playedAt: null,
      ...overrides
    });
  }

  test('an empty-state user gets empty arrays, not an error', async () => {
    const user = await usersRepo.insert(db, { email: 'fresh-dash@example.com', displayName: 'Fresh' });
    const app = buildApp({ authMode: 'proxy', db });

    const response = await app.inject({
      method: 'GET',
      url: '/api/users/me/dashboard',
      headers: { 'x-auth-request-email': 'fresh-dash@example.com', 'x-auth-request-user': 'Fresh' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      focusAreas: { active: [], resolved: [] },
      mistakeTrends: [],
      sessionHistory: []
    });
    void user;
  });

  test('aggregates findings per category across the last 20 games, splits active vs resolved focus areas, and lists completed session history', async () => {
    const user = await usersRepo.insert(db, { email: 'busy-dash@example.com', displayName: 'Busy' });
    const headers = { 'x-auth-request-email': 'busy-dash@example.com', 'x-auth-request-user': 'Busy' };

    const game = await seedGame(user.id);
    await recordFinding(db, user.id, null, game.id, {
      category: 'king_safety',
      severity: 'significant',
      ply: 14,
      description: 'Delayed castling.',
      isPositive: false
    });

    await applyFocusAreaUpdate(db, user.id, {
      category: 'king_safety',
      action: 'create',
      note: 'Delays castling under pressure.'
    });
    await applyFocusAreaUpdate(db, user.id, {
      category: 'passive_play',
      action: 'create',
      note: 'Avoids active plans.'
    });
    await applyFocusAreaUpdate(db, user.id, { category: 'passive_play', action: 'resolve', note: 'Fixed it.' });

    await db
      .insertInto('sessions')
      .values({
        gameId: game.id,
        userId: user.id,
        status: 'completed',
        summary: 'Worked on king safety today.',
        homework: 'Solve 10 rook-endgame puzzles.'
      })
      .execute();

    const app = buildApp({ authMode: 'proxy', db });
    const response = await app.inject({ method: 'GET', url: '/api/users/me/dashboard', headers });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.focusAreas.active).toEqual([
      expect.objectContaining({ category: 'king_safety', status: 'active' })
    ]);
    expect(body.focusAreas.resolved).toEqual([
      expect.objectContaining({ category: 'passive_play', status: 'resolved' })
    ]);

    expect(body.mistakeTrends).toEqual([{ category: 'king_safety', last5: 1, last20: 1 }]);

    expect(body.sessionHistory).toEqual([
      expect.objectContaining({
        gameId: game.id,
        whiteName: 'daniel',
        blackName: 'Marta',
        userColor: 'white',
        result: '1-0',
        summary: 'Worked on king safety today.',
        homework: 'Solve 10 rook-endgame puzzles.'
      })
    ]);
  });

  test('only aggregates findings from the most recent 20 games', async () => {
    const user = await usersRepo.insert(db, { email: 'old-games-dash@example.com', displayName: 'Old' });
    const headers = { 'x-auth-request-email': 'old-games-dash@example.com', 'x-auth-request-user': 'Old' };

    const oldGame = await seedGame(user.id);
    await recordFinding(db, user.id, null, oldGame.id, {
      category: 'opening_knowledge',
      severity: 'minor',
      ply: 6,
      description: 'Played an unfamiliar sideline.',
      isPositive: false
    });

    for (let i = 0; i < 20; i++) {
      await seedGame(user.id);
    }

    const app = buildApp({ authMode: 'proxy', db });
    const response = await app.inject({ method: 'GET', url: '/api/users/me/dashboard', headers });

    expect(response.json().mistakeTrends).toEqual([]);
  });

  test('rejects requests with no auth headers as 401', async () => {
    const app = buildApp({ authMode: 'proxy', db });
    const response = await app.inject({ method: 'GET', url: '/api/users/me/dashboard' });
    expect(response.statusCode).toBe(401);
  });
});
