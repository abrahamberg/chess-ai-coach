import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PositionAnalysis } from '@chess-coach/shared';
import { computePositionFeatures } from '@chess-coach/chess-analysis';
import { createTestDb, type TestDb } from '../../../test/helpers/db.js';
import type { Database } from '../schema.js';
import * as positionEvaluationsRepo from './position-evaluations.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makeAnalysis(fen: string, cp: number): PositionAnalysis {
  return {
    fen,
    depth: 16,
    multiPv: 3,
    bestMove: null,
    eval: { cp, mateIn: null },
    lines: [],
    features: computePositionFeatures(fen)
  };
}

function rawRow(db: Kysely<Database>, fen: string) {
  return db.selectFrom('positionEvaluations').selectAll().where('fen', '=', fen).executeTakeFirstOrThrow();
}

describe('position-evaluations repository', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  test('native-mode reader (allowExternal: false) only accepts native rows', async () => {
    const nativeFen = '8/8/8/8/8/8/4K3/4k3 w - - 0 1';
    const browserFen = '8/8/8/8/8/8/3K4/3k4 w - - 0 1';

    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen: nativeFen, depth: 16, multiPv: 3, analysis: makeAnalysis(nativeFen, 20) }],
      { isExternalEval: false }
    );
    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen: browserFen, depth: 16, multiPv: 3, analysis: makeAnalysis(browserFen, -5) }],
      { isExternalEval: true }
    );

    const nativeHit = await positionEvaluationsRepo.findByFen(db, nativeFen, { allowExternal: false });
    const browserOnlyMiss = await positionEvaluationsRepo.findByFen(db, browserFen, { allowExternal: false });

    expect(nativeHit?.eval.cp).toBe(20);
    expect(browserOnlyMiss).toBeUndefined();
  });

  test('browser-mode reader (allowExternal: true) accepts both native and browser rows', async () => {
    const nativeFen = '8/8/8/8/8/8/2K5/2k5 w - - 0 1';
    const browserFen = '8/8/8/8/8/8/1K6/1k6 w - - 0 1';

    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen: nativeFen, depth: 16, multiPv: 3, analysis: makeAnalysis(nativeFen, 10) }],
      { isExternalEval: false }
    );
    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen: browserFen, depth: 16, multiPv: 3, analysis: makeAnalysis(browserFen, -10) }],
      { isExternalEval: true }
    );

    const nativeHit = await positionEvaluationsRepo.findByFen(db, nativeFen, { allowExternal: true });
    const browserHit = await positionEvaluationsRepo.findByFen(db, browserFen, { allowExternal: true });

    expect(nativeHit?.eval.cp).toBe(10);
    expect(browserHit?.eval.cp).toBe(-10);
  });

  test('native write heals an existing browser-written row, overwriting it', async () => {
    const fen = '8/8/8/8/8/8/K7/k7 w - - 0 1';

    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen, depth: 10, multiPv: 3, analysis: makeAnalysis(fen, -99) }],
      { isExternalEval: true }
    );
    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen, depth: 20, multiPv: 3, analysis: makeAnalysis(fen, 42) }],
      { isExternalEval: false }
    );

    const row = await rawRow(db, fen);
    expect(row.isExternalEval).toBe(false);
    expect(row.depth).toBe(20);
    expect((row.analysis as PositionAnalysis).eval.cp).toBe(42);

    // Now visible to a native-mode reader too, since the heal flipped the flag.
    const nativeHit = await positionEvaluationsRepo.findByFen(db, fen, { allowExternal: false });
    expect(nativeHit?.eval.cp).toBe(42);
  });

  test('browser write never overwrites an existing row (native or browser)', async () => {
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen, depth: 20, multiPv: 3, analysis: makeAnalysis(fen, 7) }],
      { isExternalEval: false }
    );
    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen, depth: 10, multiPv: 3, analysis: makeAnalysis(fen, -7) }],
      { isExternalEval: true }
    );

    const row = await rawRow(db, fen);
    expect(row.isExternalEval).toBe(false);
    expect(row.depth).toBe(20);
    expect((row.analysis as PositionAnalysis).eval.cp).toBe(7);
  });

  test('a cache-hit read (findByFen) touches lastAccessedAt', async () => {
    const fen = '3k4/8/8/8/8/8/8/3K4 w - - 0 1';
    await positionEvaluationsRepo.upsertMany(
      db,
      [{ fen, depth: 16, multiPv: 3, analysis: makeAnalysis(fen, 0) }],
      { isExternalEval: false }
    );

    const backdated = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await db.updateTable('positionEvaluations').set({ lastAccessedAt: backdated }).where('fen', '=', fen).execute();
    const before = await rawRow(db, fen);
    expect(before.lastAccessedAt.getTime()).toBe(backdated.getTime());

    await positionEvaluationsRepo.findByFen(db, fen, { allowExternal: false });

    const after = await rawRow(db, fen);
    expect(after.lastAccessedAt.getTime()).toBeGreaterThan(before.lastAccessedAt.getTime());
  });

  test('pruneOverCap deletes least-recently-accessed eligible rows, respecting the min-age floor', async () => {
    // Full isolation from every other test in this suite: this test owns the
    // whole table's row count (pruneOverCap's cap check is table-wide), so it
    // clears whatever earlier tests left behind before seeding its own rows.
    await db.deleteFrom('positionEvaluations').execute();

    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const seedRows = [
      // Eligible (created 10 days ago, past the 7-day floor), oldest access — pruned first.
      { fen: 'prune-a', createdAt: new Date(now - 10 * day), lastAccessedAt: new Date(now - 10 * day) },
      // Eligible, second-oldest access — pruned second.
      { fen: 'prune-b', createdAt: new Date(now - 10 * day), lastAccessedAt: new Date(now - 5 * day) },
      // Eligible, but newest access among eligible rows — survives (cap only needs 2 evictions).
      { fen: 'prune-c', createdAt: new Date(now - 10 * day), lastAccessedAt: new Date(now - 1 * day) },
      // NOT eligible: created only 1 day ago, protected by the age floor even
      // though its lastAccessedAt is the oldest of all — must survive.
      { fen: 'prune-d', createdAt: new Date(now - 1 * day), lastAccessedAt: new Date(now - 20 * day) },
      // NOT eligible: recently created, recently accessed.
      { fen: 'prune-e', createdAt: new Date(now - 1 * day), lastAccessedAt: new Date(now) }
    ];

    for (const row of seedRows) {
      await db
        .insertInto('positionEvaluations')
        .values({
          fen: row.fen,
          depth: 16,
          multiPv: 3,
          analysis: JSON.stringify(makeAnalysis(START_FEN, 0)),
          isExternalEval: false,
          createdAt: row.createdAt,
          lastAccessedAt: row.lastAccessedAt
        })
        .execute();
    }

    // 5 rows, cap of 3 -> 2 evictions, drawn only from the eligible (age > 7d) pool.
    const deleted = await positionEvaluationsRepo.pruneOverCap(db, { maxRows: 3, minAgeDays: 7 });
    expect(deleted).toBe(2);

    const remaining = await db
      .selectFrom('positionEvaluations')
      .select('fen')
      .where(
        'fen',
        'in',
        seedRows.map((row) => row.fen)
      )
      .execute();
    expect(remaining.map((row) => row.fen).sort()).toEqual(['prune-c', 'prune-d', 'prune-e']);
  });
});
