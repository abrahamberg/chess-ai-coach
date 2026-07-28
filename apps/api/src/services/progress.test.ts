import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Finding, FocusAreaUpdate, SessionOutcome } from '@chess-coach/shared';
import * as findingsRepo from '../db/repositories/findings.js';
import * as focusAreasRepo from '../db/repositories/focus-areas.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { ValidationError } from '../lib/errors.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { applyFocusAreaUpdate, applySessionOutcome, recordFinding } from './progress.js';

describe('progress service', () => {
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

  describe('recordFinding', () => {
    test('inserts a valid finding', async () => {
      const userId = await makeUser('finding-user@example.com');
      const finding: Finding = {
        category: 'hanging_piece',
        severity: 'significant',
        ply: 12,
        description: 'Hung a knight without checking captures.',
        isPositive: false
      };

      const row = await recordFinding(db, userId, null, null, finding);

      expect(row.category).toBe('hanging_piece');
      expect(row.userId).toBe(userId);
    });

    test('rejects an unknown category with ValidationError, even bypassing the tool-layer zod schema', async () => {
      const userId = await makeUser('finding-bad-category@example.com');
      const finding = {
        category: 'laziness',
        severity: 'significant',
        ply: 12,
        description: 'x',
        isPositive: false
      } as unknown as Finding;

      await expect(recordFinding(db, userId, null, null, finding)).rejects.toThrow(ValidationError);
    });
  });

  describe('applyFocusAreaUpdate', () => {
    test('rejects an unknown category with ValidationError', async () => {
      const userId = await makeUser('focus-bad-category@example.com');
      const update = { category: 'laziness', action: 'create', note: 'x' } as unknown as FocusAreaUpdate;

      await expect(applyFocusAreaUpdate(db, userId, update)).rejects.toThrow(ValidationError);
    });

    test('creates a focus area when under the 3-active cap', async () => {
      const userId = await makeUser('focus-create@example.com');
      const update: FocusAreaUpdate = { category: 'hanging_piece', action: 'create', note: 'checks captures too slowly' };

      const result = await applyFocusAreaUpdate(db, userId, update);

      expect(result.applied).toBe(true);
      expect(result.focusArea?.status).toBe('active');
      expect(await focusAreasRepo.countActiveByUser(db, userId)).toBe(1);
    });

    test('a 4th active-focus-area create is queued, not inserted', async () => {
      const userId = await makeUser('focus-cap@example.com');
      const categories = ['hanging_piece', 'missed_tactic', 'allowed_tactic', 'calculation_error'] as const;

      const results = [];
      for (const category of categories) {
        results.push(await applyFocusAreaUpdate(db, userId, { category, action: 'create', note: 'note' }));
      }

      expect(results.slice(0, 3).every((r) => r.applied)).toBe(true);
      expect(results[3]?.applied).toBe(false);
      expect(await focusAreasRepo.countActiveByUser(db, userId)).toBe(3);
    });

    test('progress moves an active area to improving', async () => {
      const userId = await makeUser('focus-progress@example.com');
      await applyFocusAreaUpdate(db, userId, { category: 'king_safety', action: 'create', note: 'note' });

      const result = await applyFocusAreaUpdate(db, userId, {
        category: 'king_safety',
        action: 'progress',
        note: 'castled on time this game'
      });

      expect(result.applied).toBe(true);
      expect(result.focusArea?.status).toBe('improving');
    });

    test('regress moves an improving area back to active, freeing no cap slot (still counts as active)', async () => {
      const userId = await makeUser('focus-regress@example.com');
      await applyFocusAreaUpdate(db, userId, { category: 'king_safety', action: 'create', note: 'note' });
      await applyFocusAreaUpdate(db, userId, { category: 'king_safety', action: 'progress', note: 'note' });

      const result = await applyFocusAreaUpdate(db, userId, {
        category: 'king_safety',
        action: 'regress',
        note: 'left king in center again'
      });

      expect(result.focusArea?.status).toBe('active');
    });

    test('resolve moves an improving area to resolved', async () => {
      const userId = await makeUser('focus-resolve@example.com');
      await applyFocusAreaUpdate(db, userId, { category: 'king_safety', action: 'create', note: 'note' });
      await applyFocusAreaUpdate(db, userId, { category: 'king_safety', action: 'progress', note: 'note' });

      const result = await applyFocusAreaUpdate(db, userId, {
        category: 'king_safety',
        action: 'resolve',
        note: 'consistently castling now'
      });

      expect(result.focusArea?.status).toBe('resolved');
    });

    test('progress/regress/resolve on a non-existent focus area is a no-op', async () => {
      const userId = await makeUser('focus-noop@example.com');

      const result = await applyFocusAreaUpdate(db, userId, {
        category: 'no_plan',
        action: 'resolve',
        note: 'note'
      });

      expect(result.applied).toBe(false);
    });
  });

  describe('applySessionOutcome', () => {
    async function makeSession(email: string) {
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
      return { userId: user.id, gameId: game.id, sessionId: session.id };
    }

    function outcome(overrides: Partial<SessionOutcome> = {}): SessionOutcome {
      return {
        sessionSummary: 'You worked on king safety today.',
        homework: 'Review two rook-endgame puzzles.',
        findings: [],
        focusAreaUpdates: [],
        ...overrides
      };
    }

    test('skips a finding already recorded live (same session, category, and ply)', async () => {
      const ctx = await makeSession('dedup@example.com');
      await recordFinding(db, ctx.userId, ctx.sessionId, ctx.gameId, {
        category: 'hanging_piece',
        severity: 'significant',
        ply: 12,
        description: 'Recorded live during the session.',
        isPositive: false
      });

      await applySessionOutcome(
        db,
        ctx,
        outcome({
          findings: [
            {
              category: 'hanging_piece',
              severity: 'significant',
              ply: 12,
              description: 'Summarizer re-noticed the same thing.',
              isPositive: false
            }
          ]
        })
      );

      const rows = await findingsRepo.listRecentByUser(db, ctx.userId, 10);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.description).toBe('Recorded live during the session.');
    });

    test('inserts a new finding not already recorded (different ply)', async () => {
      const ctx = await makeSession('newfinding@example.com');

      await applySessionOutcome(
        db,
        ctx,
        outcome({
          findings: [
            {
              category: 'hanging_piece',
              severity: 'minor',
              ply: 20,
              description: 'Caught by the summarizer only.',
              isPositive: false
            }
          ]
        })
      );

      const rows = await findingsRepo.listRecentByUser(db, ctx.userId, 10);
      expect(rows).toHaveLength(1);
    });

    test('applies a resolve focus-area update, moving state to resolved', async () => {
      const ctx = await makeSession('outcome-resolve@example.com');
      await applyFocusAreaUpdate(db, ctx.userId, { category: 'king_safety', action: 'create', note: 'n' });
      await applyFocusAreaUpdate(db, ctx.userId, { category: 'king_safety', action: 'progress', note: 'n' });

      await applySessionOutcome(
        db,
        ctx,
        outcome({
          focusAreaUpdates: [{ category: 'king_safety', action: 'resolve', note: 'consistently castling now' }]
        })
      );

      const area = await focusAreasRepo.findByUserAndCategory(db, ctx.userId, 'king_safety');
      expect(area?.status).toBe('resolved');
    });

    test('applies a regress focus-area update on a resolved area, moving it back to active', async () => {
      const ctx = await makeSession('outcome-regress@example.com');
      await applyFocusAreaUpdate(db, ctx.userId, { category: 'king_safety', action: 'create', note: 'n' });
      await applyFocusAreaUpdate(db, ctx.userId, { category: 'king_safety', action: 'progress', note: 'n' });
      await applyFocusAreaUpdate(db, ctx.userId, { category: 'king_safety', action: 'resolve', note: 'n' });

      await applySessionOutcome(
        db,
        ctx,
        outcome({
          focusAreaUpdates: [{ category: 'king_safety', action: 'regress', note: 'left king in center again' }]
        })
      );

      const area = await focusAreasRepo.findByUserAndCategory(db, ctx.userId, 'king_safety');
      expect(area?.status).toBe('active');
    });

    test('stores the summary and homework on the session', async () => {
      const ctx = await makeSession('outcome-summary@example.com');

      await applySessionOutcome(
        db,
        ctx,
        outcome({ sessionSummary: 'Great progress on tactics.', homework: 'Solve 10 puzzles.' })
      );

      const session = await sessionsRepo.findById(db, ctx.sessionId);
      expect(session).toMatchObject({ summary: 'Great progress on tactics.', homework: 'Solve 10 puzzles.' });
    });
  });
});
