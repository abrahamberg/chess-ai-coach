import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import type { Database } from '../db/schema.js';
import { createKeyVault } from '../llm/key-vault.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';

describe('PUT/DELETE /api/users/me/llm-keys/:provider', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;
  const keyVault = createKeyVault(randomBytes(32).toString('base64'));

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  const headers = { 'x-auth-request-email': 'byok@example.com', 'x-auth-request-user': 'Byok' };

  test('PUT stores the key and never echoes it back', async () => {
    const app = buildApp({ authMode: 'proxy', db, keyVault });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/users/me/llm-keys/anthropic',
      headers,
      payload: { apiKey: 'sk-ant-real-secret' }
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).not.toContain('sk-ant-real-secret');

    const row = await db
      .selectFrom('userLlmKeys')
      .selectAll()
      .where('provider', '=', 'anthropic')
      .executeTakeFirstOrThrow();
    expect(keyVault.decrypt({ ciphertext: row.keyCiphertext, iv: row.keyIv })).toBe(
      'sk-ant-real-secret'
    );
  });

  test('PUT again overwrites the stored key for the same provider', async () => {
    const app = buildApp({ authMode: 'proxy', db, keyVault });

    await app.inject({
      method: 'PUT',
      url: '/api/users/me/llm-keys/anthropic',
      headers,
      payload: { apiKey: 'sk-ant-updated-secret' }
    });

    const rows = await db
      .selectFrom('userLlmKeys')
      .selectAll()
      .where('provider', '=', 'anthropic')
      .execute();
    expect(rows).toHaveLength(1);
    expect(keyVault.decrypt({ ciphertext: rows[0]!.keyCiphertext, iv: rows[0]!.keyIv })).toBe(
      'sk-ant-updated-secret'
    );
  });

  test('rejects an unknown provider as 400', async () => {
    const app = buildApp({ authMode: 'proxy', db, keyVault });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/users/me/llm-keys/cohere',
      headers,
      payload: { apiKey: 'whatever' }
    });

    expect(response.statusCode).toBe(400);
  });

  test('DELETE removes the stored key', async () => {
    const app = buildApp({ authMode: 'proxy', db, keyVault });
    await app.inject({
      method: 'PUT',
      url: '/api/users/me/llm-keys/openai',
      headers,
      payload: { apiKey: 'sk-oai-secret' }
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/users/me/llm-keys/openai',
      headers
    });

    expect(response.statusCode).toBe(204);
    const row = await db
      .selectFrom('userLlmKeys')
      .selectAll()
      .where('provider', '=', 'openai')
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});
