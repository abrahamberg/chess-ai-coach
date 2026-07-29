import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { EngineEval } from '@chess-coach/shared';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import { buildCoachTools, type CoachToolsDependencies } from './coach-tools.js';

const ENGINE_EVAL: EngineEval = {
  ply: 4,
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  depth: 18,
  lines: [{ moveUci: 'f1b5', moveSan: 'Bb5', cp: 35, mateIn: null }]
};

describe('buildCoachTools', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function setupCtx(pgn = '1. e4 e5') {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn,
      source: 'paste',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    const session = await db
      .insertInto('sessions')
      .values({ gameId: game.id, userId: user.id, status: 'active' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { userId: user.id, gameId: game.id, sessionId: session.id };
  }

  function makeDeps(overrides: Partial<CoachToolsDependencies> = {}): CoachToolsDependencies {
    return {
      db,
      analyzePosition: vi.fn().mockResolvedValue(ENGINE_EVAL),
      callLightModel: vi.fn().mockResolvedValue('Bb5 pins the knight; the idea is to double pawns after Bxc6.'),
      ...overrides
    };
  }

  test('exposes all 9 architecture §7.1 tools', async () => {
    const ctx = await setupCtx();
    const tools = buildCoachTools(ctx, makeDeps());

    expect(Object.keys(tools).sort()).toEqual(
      [
        'annotate_board',
        'check_position',
        'end_session',
        'get_engine_analysis',
        'get_user_profile',
        'propose_focus_area_update',
        'record_finding',
        'show_position',
        'update_threads'
      ].sort()
    );
  });

  test('show_position and annotate_board have no execute (client tools)', async () => {
    const ctx = await setupCtx();
    const tools = buildCoachTools(ctx, makeDeps());

    expect(tools.show_position?.execute).toBeUndefined();
    expect(tools.annotate_board?.execute).toBeUndefined();
  });

  describe('get_engine_analysis', () => {
    test('returns the interpreter subagent\'s text, prefixed, with no raw UCI lines', async () => {
      const ctx = await setupCtx();
      const deps = makeDeps();
      const tools = buildCoachTools(ctx, deps);

      const result = await tools.get_engine_analysis?.execute?.(
        { fen: ENGINE_EVAL.fen, question: 'is Bb5 good here?' },
        { toolCallId: '1', messages: [] }
      );

      expect(result).toEqual({
        text: '[engine check] Bb5 pins the knight; the idea is to double pawns after Bxc6.'
      });
      expect(JSON.stringify(result)).not.toMatch(/f1b5|moveUci|"cp":/);
      expect(deps.callLightModel).toHaveBeenCalledOnce();
      const [messages] = (deps.callLightModel as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { system: string; user: string }
      ];
      expect(messages.user).toContain('Bb5');
    });

    test('3rd call in one turn returns a budget_exhausted error instead of executing', async () => {
      const ctx = await setupCtx();
      const deps = makeDeps();
      const tools = buildCoachTools(ctx, deps);
      const call = (question: string) =>
        tools.get_engine_analysis?.execute?.({ fen: ENGINE_EVAL.fen, question }, { toolCallId: '1', messages: [] });

      await call('question 1');
      await call('question 2');
      const third = await call('question 3');

      expect(third).toEqual({ error: 'budget_exhausted — answer with what you have' });
      expect(deps.analyzePosition).toHaveBeenCalledTimes(2);
    });

    test('identical repeated call (same name + args) returns the cached result without a second service invocation', async () => {
      const ctx = await setupCtx();
      const deps = makeDeps();
      const tools = buildCoachTools(ctx, deps);
      const args = { fen: ENGINE_EVAL.fen, question: 'same question' };

      const first = await tools.get_engine_analysis?.execute?.(args, { toolCallId: '1', messages: [] });
      const second = await tools.get_engine_analysis?.execute?.(args, { toolCallId: '2', messages: [] });

      expect(second).toEqual(first);
      expect(deps.analyzePosition).toHaveBeenCalledTimes(1);
      expect(deps.callLightModel).toHaveBeenCalledTimes(1);
    });
  });

  describe('check_position', () => {
    test('returns the authoritative fen and moveSan for a move in the game, without touching the client board', async () => {
      const ctx = await setupCtx('1. e4 e5 2. Nf3 Nc6');
      const tools = buildCoachTools(ctx, makeDeps());

      const result = await tools.check_position?.execute?.(
        { moveNumber: 2, color: 'white' },
        { toolCallId: '1', messages: [] }
      );

      expect(result).toEqual({
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
        moveSan: 'Nf3'
      });
    });

    test('a move beyond the game length returns an error, not a guessed position', async () => {
      const ctx = await setupCtx('1. e4 e5');
      const tools = buildCoachTools(ctx, makeDeps());

      const result = await tools.check_position?.execute?.(
        { moveNumber: 20, color: 'white' },
        { toolCallId: '1', messages: [] }
      );

      expect(result).toEqual({ error: 'that move does not exist in this game' });
    });
  });

  describe('record_finding', () => {
    test('records a finding through the progress service', async () => {
      const ctx = await setupCtx();
      const tools = buildCoachTools(ctx, makeDeps());

      const result = await tools.record_finding?.execute?.(
        {
          category: 'hanging_piece',
          severity: 'significant',
          ply: 12,
          description: 'Hung a knight.',
          isPositive: false
        },
        { toolCallId: '1', messages: [] }
      );

      expect(result).toEqual({ recorded: true });
      const rows = await db.selectFrom('findings').selectAll().where('userId', '=', ctx.userId).execute();
      expect(rows).toHaveLength(1);
    });
  });

  describe('propose_focus_area_update', () => {
    test('a 4th active-focus-area create is queued (applied: false), not inserted', async () => {
      const ctx = await setupCtx();
      const tools = buildCoachTools(ctx, makeDeps());
      const categories = ['hanging_piece', 'missed_tactic', 'allowed_tactic', 'calculation_error'] as const;

      const results = [];
      for (const category of categories) {
        results.push(
          await tools.propose_focus_area_update?.execute?.(
            { category, action: 'create', note: 'note' },
            { toolCallId: '1', messages: [] }
          )
        );
      }

      expect(results.slice(0, 3).every((r) => (r as { applied: boolean }).applied)).toBe(true);
      expect((results[3] as { applied: boolean }).applied).toBe(false);
    });
  });

  describe('update_threads', () => {
    test('persists the ledger and returns it', async () => {
      const ctx = await setupCtx();
      const tools = buildCoachTools(ctx, makeDeps());
      const threads = [
        {
          id: 1,
          topic: 'branch 14.Nxd5',
          status: 'parked' as const,
          hypothesis: 'stops calculating after first capture',
          anchorPly: 27,
          anchorFen: null
        }
      ];

      const result = await tools.update_threads?.execute?.({ threads }, { toolCallId: '1', messages: [] });

      expect(result).toEqual(threads);
      const row = await db
        .selectFrom('sessions')
        .select('threads')
        .where('id', '=', ctx.sessionId)
        .executeTakeFirstOrThrow();
      expect(row.threads).toEqual(threads);
    });

    test('rejects 2 active threads with a ValidationError-shaped rejection', async () => {
      const ctx = await setupCtx();
      const tools = buildCoachTools(ctx, makeDeps());
      const threads = [
        { id: 1, topic: 'a', status: 'active' as const, hypothesis: null, anchorPly: null, anchorFen: null },
        { id: 2, topic: 'b', status: 'active' as const, hypothesis: null, anchorPly: null, anchorFen: null }
      ];

      await expect(
        tools.update_threads?.execute?.({ threads }, { toolCallId: '1', messages: [] })
      ).rejects.toThrow();
    });
  });
});
