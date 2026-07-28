import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as usersRepo from '../db/repositories/users.js';
import * as creditsRepo from '../db/repositories/credits.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { createCreditsService } from './credits.js';
import { InsufficientCreditsError } from '../lib/errors.js';

describe('creditsService', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function makeUser(email: string): Promise<string> {
    const user = await usersRepo.insert(db, { email, displayName: email });
    return user.id;
  }

  test('balance reflects the ledger', async () => {
    const userId = await makeUser('balance-user@example.com');
    await creditsRepo.insertSignupGrant(db, userId);
    const service = createCreditsService(db);

    expect(await service.balance(userId)).toBe(100);
  });

  test('assertCanSpend resolves when balance is positive', async () => {
    const userId = await makeUser('spend-ok@example.com');
    await creditsRepo.insertSignupGrant(db, userId);
    const service = createCreditsService(db);

    await expect(service.assertCanSpend(userId)).resolves.toBeUndefined();
  });

  test('assertCanSpend throws InsufficientCreditsError when balance is 0', async () => {
    const userId = await makeUser('spend-zero@example.com');
    const service = createCreditsService(db);

    await expect(service.assertCanSpend(userId)).rejects.toThrow(InsufficientCreditsError);
  });
});
