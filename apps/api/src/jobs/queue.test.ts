import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { createGraphileJobQueue, type GraphileJobQueueHandle } from './queue.js';

describe('createGraphileJobQueue', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;
  let handle: GraphileJobQueueHandle;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    handle = await createGraphileJobQueue(testDb.connectionString);
  }, 60000);

  afterAll(async () => {
    await handle.close();
    await testDb.cleanup();
  });

  test('enqueueAnalyzeGame inserts a real graphile_worker job row', async () => {
    const gameId = crypto.randomUUID();

    await handle.queue.enqueueAnalyzeGame(gameId);

    // Read through the same Kysely instance (CamelCasePlugin), so aliased
    // columns come back camelCased regardless of the query builder vs sql tag.
    const jobs = await sql<{ taskIdentifier: string; payload: { gameId: string } }>`
      select t.identifier as task_identifier, j.payload
      from graphile_worker._private_jobs j
      join graphile_worker._private_tasks t on t.id = j.task_id
    `.execute(db);

    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.taskIdentifier).toBe('analyze-game');
    expect(jobs.rows[0]?.payload).toEqual({ gameId });
  }, 20000);
});
