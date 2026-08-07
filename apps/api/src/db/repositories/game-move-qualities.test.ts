import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../../test/helpers/db.js';
import * as usersRepo from './users.js';
import * as gamesRepo from './games.js';
import * as gameMoveQualitiesRepo from './game-move-qualities.js';
import type { Database } from '../schema.js';

describe('game-move-qualities repository', () => {
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
  }

  test('insert() then listByGameId() round-trips all fields in ply order', async () => {
    const game = await seedGame();
    await gameMoveQualitiesRepo.insert(db, {
      gameId: game.id,
      ply: 2,
      moveSan: 'e5',
      mover: 'black',
      quality: 'best',
      cpLoss: 0,
      bestLineSan: ['e5'],
      evalAfterCp: 20
    });
    await gameMoveQualitiesRepo.insert(db, {
      gameId: game.id,
      ply: 1,
      moveSan: 'e4',
      mover: 'white',
      quality: 'good',
      cpLoss: 5,
      bestLineSan: ['d4'],
      evalAfterCp: 15
    });

    const rows = await gameMoveQualitiesRepo.listByGameId(db, game.id);
    expect(rows.map((row) => row.ply)).toEqual([1, 2]);
    expect(rows[0]?.moveSan).toBe('e4');
    expect(rows[0]?.bestLineSan).toEqual(['d4']);
    expect(rows[1]?.quality).toBe('best');
  });

  test('deleteByPly() removes only the targeted ply', async () => {
    const game = await seedGame();
    await gameMoveQualitiesRepo.insert(db, {
      gameId: game.id,
      ply: 1,
      moveSan: 'e4',
      mover: 'white',
      quality: 'good',
      cpLoss: 5,
      bestLineSan: ['d4'],
      evalAfterCp: 15
    });
    await gameMoveQualitiesRepo.insert(db, {
      gameId: game.id,
      ply: 2,
      moveSan: 'e5',
      mover: 'black',
      quality: 'best',
      cpLoss: 0,
      bestLineSan: ['e5'],
      evalAfterCp: 20
    });

    await gameMoveQualitiesRepo.deleteByPly(db, game.id, 2);

    const rows = await gameMoveQualitiesRepo.listByGameId(db, game.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ply).toBe(1);
  });

  test('listByGameId() returns an empty array when nothing has been recorded', async () => {
    const game = await seedGame();
    const rows = await gameMoveQualitiesRepo.listByGameId(db, game.id);
    expect(rows).toEqual([]);
  });
});
