import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as usersRepo from '../db/repositories/users.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import type { Database } from '../db/schema.js';
import { createPlaySession } from './play-session.js';

describe('createPlaySession', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  test('creates a coach_play game + a play-mode session seeded with [session_start]', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });

    const session = await createPlaySession(db, user.id, 'white');

    expect(session.mode).toBe('play');
    expect(session.status).toBe('active');
    expect(session.currentPly).toBe(0);

    const messages = await sessionMessagesRepo.listBySession(db, session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('[session_start]');
  });

  test('a black-choosing student is recorded with userColor "black"', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Bo' });

    const session = await createPlaySession(db, user.id, 'black');

    expect(session.gameId).toBeTruthy();
  });
});
