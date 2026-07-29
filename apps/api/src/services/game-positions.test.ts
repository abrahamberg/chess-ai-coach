import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { getPositionAtPly } from './game-positions.js';

const PGN = `[Event "Test"]
[White "Ann"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

describe('getPositionAtPly', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function insertGame() {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    return gamesRepo.insert(db, {
      userId: user.id,
      pgn: PGN,
      source: 'paste',
      userColor: 'white',
      whiteName: 'Ann',
      blackName: 'Bob',
      result: '1-0',
      timeControl: '10+0',
      eco: null,
      playedAt: null
    });
  }

  test('ply 0 is the game start, with no move played yet', async () => {
    const game = await insertGame();
    const position = await getPositionAtPly(db, game.id, 0);
    expect(position?.moveSan).toBeNull();
    expect(position?.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  test('a later ply replays the PGN to the actual resulting FEN, not a guess', async () => {
    const game = await insertGame();
    const position = await getPositionAtPly(db, game.id, 4);
    expect(position?.moveSan).toBe('Nc6');
    expect(position?.fen).toBe('r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3');
  });

  test('a ply beyond the game length is undefined', async () => {
    const game = await insertGame();
    const position = await getPositionAtPly(db, game.id, 999);
    expect(position).toBeUndefined();
  });

  test('an unknown game id is undefined', async () => {
    const position = await getPositionAtPly(db, crypto.randomUUID(), 0);
    expect(position).toBeUndefined();
  });
});
