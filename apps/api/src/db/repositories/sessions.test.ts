import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../../test/helpers/db.js';
import * as usersRepo from './users.js';
import * as gamesRepo from './games.js';
import * as sessionsRepo from './sessions.js';
import type { Database } from '../schema.js';

describe('sessions repository — mode', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedGame() {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    return gamesRepo.insert(db, {
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
  }

  test('insert() defaults mode to "analyze" when omitted', async () => {
    const game = await seedGame();
    const session = await sessionsRepo.insert(db, { gameId: game.id, userId: game.userId });
    expect(session.mode).toBe('analyze');
  });

  test('insert() accepts an explicit mode of "play"', async () => {
    const game = await seedGame();
    const session = await sessionsRepo.insert(db, { gameId: game.id, userId: game.userId, mode: 'play' });
    expect(session.mode).toBe('play');

    const found = await sessionsRepo.findById(db, session.id);
    expect(found?.mode).toBe('play');
  });
});
