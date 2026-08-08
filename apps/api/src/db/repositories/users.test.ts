import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../../test/helpers/db.js';
import * as usersRepo from './users.js';
import type { Database } from '../schema.js';

describe('users repository', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 120000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  test('insert() includes engineMode with default value "native"', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Alice' });

    expect(user.engineMode).toBe('native');
  });

  test('update() can change engineMode', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Bob' });

    const updated = await usersRepo.update(db, user.id, { engineMode: 'browser' });

    expect(updated.engineMode).toBe('browser');
  });

  test('findById() returns user with engineMode', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Charlie' });

    const fetched = await usersRepo.findById(db, user.id);

    expect(fetched).toBeDefined();
    expect(fetched?.engineMode).toBe('native');
  });
});
