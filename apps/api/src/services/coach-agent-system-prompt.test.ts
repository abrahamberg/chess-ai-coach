import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { buildSystemPromptForSession } from './coach-agent-system-prompt.js';

describe('buildSystemPromptForSession — play mode (architecture §14)', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  test('never queries analysesRepo for a play-mode session — there is no analyses row to find', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: '',
      source: 'coach_play',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    const session = await sessionsRepo.insert(db, { gameId: game.id, userId: user.id, mode: 'play' });
    const findCoachingPlanSpy = vi.spyOn(analysesRepo, 'findCoachingPlanByGameId');

    const prompt = await buildSystemPromptForSession(db, session);

    expect(findCoachingPlanSpy).not.toHaveBeenCalled();
    expect(prompt.staticPart).toContain('play_coach_move');
    expect(prompt.dynamicPart).not.toContain('preparation notes');
    findCoachingPlanSpy.mockRestore();
  });

  test('analyze mode is unaffected: still requires and uses a coaching plan', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
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

    await expect(buildSystemPromptForSession(db, session)).rejects.toThrow('Coaching plan not found');
  });
});
