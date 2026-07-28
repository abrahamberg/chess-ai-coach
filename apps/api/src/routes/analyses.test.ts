import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../app.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';

const PGN = `[Event "Test"]

1. e4 e5 1-0`;

describe('GET /api/analyses/:id/status', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function setupGame(email: string) {
    const user = await usersRepo.insert(db, { email, displayName: email });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: PGN,
      source: 'paste',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    const analysis = await analysesRepo.insertQueued(db, game.id);
    return { user, game, analysis };
  }

  function parseSseFrames(payload: string): Array<{ status: string }> {
    return payload
      .split('\n\n')
      .filter((chunk) => chunk.trim().length > 0)
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, '')));
  }

  test('streams status changes and ends once a terminal state is reached', async () => {
    const { user, analysis } = await setupGame('sse-user@example.com');
    const app = buildApp({ authMode: 'proxy', db, analysesPollIntervalMs: 10 });
    const headers = { 'x-auth-request-email': user.email, 'x-auth-request-user': user.displayName };

    // Spaced generously relative to the 10ms poll interval so each transition
    // gets many poll ticks to be observed even when the suite runs under load
    // (many concurrent Testcontainers) — a starved event loop could otherwise
    // let two transitions land between ticks, which a polling design will
    // legitimately coalesce (matches production: poll DB 1s).
    setTimeout(() => {
      void analysesRepo.updateStatus(db, analysis.id, 'engine_running');
    }, 300);
    setTimeout(() => {
      void analysesRepo.updateStatus(db, analysis.id, 'planning');
    }, 900);
    setTimeout(() => {
      void analysesRepo.markFailed(db, analysis.id, 'boom');
    }, 1500);

    const response = await app.inject({
      method: 'GET',
      url: `/api/analyses/${analysis.id}/status`,
      headers
    });

    expect(response.statusCode).toBe(200);
    const frames = parseSseFrames(response.payload);
    expect(frames.map((f) => f.status)).toEqual(['queued', 'engine_running', 'planning', 'failed']);
  }, 20000);

  test('404s for an analysis belonging to another user\'s game', async () => {
    const { analysis } = await setupGame('owner2@example.com');
    const app = buildApp({ authMode: 'proxy', db, analysesPollIntervalMs: 10 });

    const response = await app.inject({
      method: 'GET',
      url: `/api/analyses/${analysis.id}/status`,
      headers: { 'x-auth-request-email': 'intruder2@example.com', 'x-auth-request-user': 'Intruder' }
    });

    expect(response.statusCode).toBe(404);
  });
});
