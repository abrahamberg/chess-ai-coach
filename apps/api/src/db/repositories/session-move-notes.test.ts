import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../../test/helpers/db.js';
import * as usersRepo from './users.js';
import * as gamesRepo from './games.js';
import * as sessionsRepo from './sessions.js';
import * as sessionMoveNotesRepo from './session-move-notes.js';
import type { Database } from '../schema.js';

describe('session-move-notes repository', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedSession() {
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
    return sessionsRepo.insert(db, { gameId: game.id, userId: user.id });
  }

  test('upsert() creates a note, then a second call for the same ply overwrites it (last write wins)', async () => {
    const session = await seedSession();
    await sessionMoveNotesRepo.upsert(db, session.id, 4, 'first draft');
    const updated = await sessionMoveNotesRepo.upsert(db, session.id, 4, 'final note');

    expect(updated.note).toBe('final note');
    const rows = await sessionMoveNotesRepo.listOtherPlies(db, session.id, [-1]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.note).toBe('final note');
  });

  test('findByPly returns undefined when nothing was ever recorded for that ply', async () => {
    const session = await seedSession();
    const row = await sessionMoveNotesRepo.findByPly(db, session.id, 99);
    expect(row).toBeUndefined();
  });

  test('listOtherPlies excludes the current ply and orders the rest ascending', async () => {
    const session = await seedSession();
    await sessionMoveNotesRepo.upsert(db, session.id, 8, 'later note');
    await sessionMoveNotesRepo.upsert(db, session.id, 4, 'earlier note');
    await sessionMoveNotesRepo.upsert(db, session.id, 12, 'current — excluded');

    const rows = await sessionMoveNotesRepo.listOtherPlies(db, session.id, [12]);

    expect(rows.map((r) => r.ply)).toEqual([4, 8]);
  });

  test('listOtherPlies excludes every ply in the array (e.g. board ply and subject ply mid-flashback)', async () => {
    const session = await seedSession();
    await sessionMoveNotesRepo.upsert(db, session.id, 8, 'later note');
    await sessionMoveNotesRepo.upsert(db, session.id, 4, 'earlier note');
    await sessionMoveNotesRepo.upsert(db, session.id, 12, 'subject — excluded');
    await sessionMoveNotesRepo.upsert(db, session.id, 20, 'board ply — excluded');

    const rows = await sessionMoveNotesRepo.listOtherPlies(db, session.id, [12, 20]);

    expect(rows.map((r) => r.ply)).toEqual([4, 8]);
  });

  test('deleteByPly removes only the targeted ply', async () => {
    const session = await seedSession();
    await sessionMoveNotesRepo.upsert(db, session.id, 4, 'kept');
    await sessionMoveNotesRepo.upsert(db, session.id, 6, 'removed');

    await sessionMoveNotesRepo.deleteByPly(db, session.id, 6);

    expect(await sessionMoveNotesRepo.findByPly(db, session.id, 6)).toBeUndefined();
    expect(await sessionMoveNotesRepo.findByPly(db, session.id, 4)).toBeDefined();
  });
});
