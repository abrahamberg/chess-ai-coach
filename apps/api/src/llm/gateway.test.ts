import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import * as usersRepo from '../db/repositories/users.js';
import * as creditsRepo from '../db/repositories/credits.js';
import * as llmKeysRepo from '../db/repositories/llm-keys.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { createKeyVault } from './key-vault.js';
import { getModelForUser, recordUsage, type GatewayConfig } from './gateway.js';

const config: GatewayConfig = {
  keyVault: createKeyVault(randomBytes(32).toString('base64')),
  platformKeys: { anthropic: 'platform-anthropic-key' },
  modelIds: {
    standard: { anthropic: 'claude-standard', openai: 'gpt-standard' },
    light: { anthropic: 'claude-light', openai: 'gpt-light' }
  }
};

describe('llm gateway', () => {
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

  describe('getModelForUser', () => {
    test('falls back to the platform key when the user has no BYOK key', async () => {
      const userId = await makeUser('platform-user@example.com');

      const resolution = await getModelForUser(db, config, userId, 'standard');

      expect(resolution.provider).toBe('anthropic');
      expect(resolution.metered).toBe(true);
      expect(resolution.model).toBeDefined();
    });

    test('uses the user\'s BYOK key and reports metered:false', async () => {
      const userId = await makeUser('byok-user@example.com');
      const { ciphertext, iv } = config.keyVault.encrypt('sk-ant-byok-secret');
      await llmKeysRepo.upsert(db, userId, 'openai', ciphertext, iv);

      const resolution = await getModelForUser(db, config, userId, 'light');

      expect(resolution.provider).toBe('openai');
      expect(resolution.metered).toBe(false);
      expect(resolution.model).toBeDefined();
    });

    test('prefers anthropic when the user has BYOK keys for both providers', async () => {
      const userId = await makeUser('both-keys-user@example.com');
      const anthropicKey = config.keyVault.encrypt('sk-ant-1');
      const openaiKey = config.keyVault.encrypt('sk-oai-1');
      await llmKeysRepo.upsert(db, userId, 'openai', openaiKey.ciphertext, openaiKey.iv);
      await llmKeysRepo.upsert(db, userId, 'anthropic', anthropicKey.ciphertext, anthropicKey.iv);

      const resolution = await getModelForUser(db, config, userId, 'standard');

      expect(resolution.provider).toBe('anthropic');
      expect(resolution.metered).toBe(false);
    });

    test('Task 7.2: config.fake short-circuits to a canned model, never touching keys or the DB', async () => {
      const fakeConfig: GatewayConfig = { ...config, fake: true };

      const resolution = await getModelForUser(db, fakeConfig, 'nonexistent-user-id', 'standard');

      expect(resolution.metered).toBe(false);
      expect(resolution.model).toBeDefined();
    });
  });

  describe('recordUsage', () => {
    beforeEach(async () => {
      // no-op: each test creates its own user
    });

    test('metered usage writes a debited ledger row and a call-log row atomically', async () => {
      const userId = await makeUser('metered-usage@example.com');
      await creditsRepo.insertSignupGrant(db, userId);

      await recordUsage(db, {
        userId,
        provider: 'anthropic',
        model: 'claude-standard',
        tier: 'standard',
        usage: { inputTokens: 2000, outputTokens: 1000, cachedInputTokens: 0 },
        purpose: 'coach_turn',
        metered: true
      });

      const balance = await creditsRepo.balance(db, userId);
      expect(balance).toBe(97); // 100 signup - ceil(3000/1000 * 1) = 100 - 3

      const logs = await db
        .selectFrom('llmCallLog')
        .selectAll()
        .where('userId', '=', userId)
        .execute();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        provider: 'anthropic',
        model: 'claude-standard',
        inputTokens: 2000,
        outputTokens: 1000,
        creditsMetered: 3,
        purpose: 'coach_turn'
      });
    });

    test('BYOK (unmetered) usage logs the call with 0 credits and never touches the ledger', async () => {
      const userId = await makeUser('byok-usage@example.com');
      await creditsRepo.insertSignupGrant(db, userId);

      await recordUsage(db, {
        userId,
        provider: 'openai',
        model: 'gpt-light',
        tier: 'light',
        usage: { inputTokens: 5000, outputTokens: 1000, cachedInputTokens: 0 },
        purpose: 'analysis_plan',
        metered: false
      });

      const balance = await creditsRepo.balance(db, userId);
      expect(balance).toBe(100);

      const logs = await db
        .selectFrom('llmCallLog')
        .selectAll()
        .where('userId', '=', userId)
        .execute();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.creditsMetered).toBe(0);
    });
  });
});
