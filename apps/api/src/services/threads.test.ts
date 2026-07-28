import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Thread } from '@chess-coach/shared';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { ValidationError } from '../lib/errors.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { createThreadsService } from './threads.js';

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 1,
    topic: 'branch 14.Nxd5',
    status: 'parked',
    hypothesis: 'stops calculating after first capture',
    anchorPly: 27,
    anchorFen: null,
    ...overrides
  };
}

describe('threadsService', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function makeSessionId(email: string): Promise<string> {
    const user = await usersRepo.insert(db, { email, displayName: email });
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
    const session = await sessionsRepo.insert(db, { gameId: game.id, userId: user.id });
    return session.id;
  }

  test('replace persists and returns a valid ledger', async () => {
    const sessionId = await makeSessionId('threads-valid@example.com');
    const service = createThreadsService(db);
    const threads = [thread({ id: 1 }), thread({ id: 2, status: 'resolved' })];

    const result = await service.replace(sessionId, threads);

    expect(result).toEqual(threads);
    expect(await sessionsRepo.getThreads(db, sessionId)).toEqual(threads);
  });

  test('rejects more than 1 active thread', async () => {
    const sessionId = await makeSessionId('threads-two-active@example.com');
    const service = createThreadsService(db);
    const threads = [
      thread({ id: 1, status: 'active' }),
      thread({ id: 2, status: 'active' })
    ];

    await expect(service.replace(sessionId, threads)).rejects.toThrow(ValidationError);
  });

  test('rejects more than 8 threads', async () => {
    const sessionId = await makeSessionId('threads-too-many@example.com');
    const service = createThreadsService(db);
    const threads = Array.from({ length: 9 }, (_, i) => thread({ id: i + 1, status: 'parked' }));

    await expect(service.replace(sessionId, threads)).rejects.toThrow(ValidationError);
  });

  test('rejects an invalid thread shape', async () => {
    const sessionId = await makeSessionId('threads-invalid-shape@example.com');
    const service = createThreadsService(db);
    const invalid = [{ ...thread(), status: 'open' }] as unknown as Thread[];

    await expect(service.replace(sessionId, invalid)).rejects.toThrow(ValidationError);
  });

  test('an empty ledger is valid', async () => {
    const sessionId = await makeSessionId('threads-empty@example.com');
    const service = createThreadsService(db);

    const result = await service.replace(sessionId, []);

    expect(result).toEqual([]);
  });
});
