import type { Kysely } from 'kysely';
import { MockLanguageModelV1 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { CoachingPlan, EngineEval } from '@chess-coach/shared';
import { buildApp } from '../app.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as creditsRepo from '../db/repositories/credits.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { createKeyVault } from '../llm/key-vault.js';
import type { GatewayConfig } from '../llm/gateway.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import type { CoachAgentDependencies } from '../services/coach-agent.js';

const PLAN: CoachingPlan = {
  gameSummary: 'A sharp game.',
  openingNote: 'Fine.',
  themes: ['king_safety'],
  connectionToHistory: 'First session together.',
  moments: [
    {
      ply: 4,
      kind: 'user_mistake' as const,
      category: 'king_safety' as const,
      whatHappened: 'Missed the mating idea.',
      socraticQuestion: 'What was your opponent threatening?',
      keyLine: 'Qxf7#',
      revealDepthPlies: 2
    }
  ]
};

const PGN = `[Event "Test"]
[White "Ann"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

function textStreamModel(text: string, toolCall?: { toolCallId: string; toolName: string; args: unknown }) {
  const parts: Array<Record<string, unknown>> = [{ type: 'text-delta', textDelta: text }];
  if (toolCall) {
    parts.push({
      type: 'tool-call',
      toolCallType: 'function',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: JSON.stringify(toolCall.args)
    });
  }
  parts.push({
    type: 'finish',
    finishReason: toolCall ? 'tool-calls' : 'stop',
    usage: { promptTokens: 500, completionTokens: 50 }
  });

  const doStream = vi.fn().mockImplementation((options: unknown) =>
    Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        }
      }),
      rawCall: { rawPrompt: options, rawSettings: {} }
    })
  );

  const model = new MockLanguageModelV1({ doStream });
  return { model, doStream };
}

describe('sessions routes', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;
  const keyVault = createKeyVault(Buffer.alloc(32, 7).toString('base64'));

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function setupReadyGame(email: string) {
    const user = await usersRepo.insert(db, { email, displayName: 'Ann' });
    await creditsRepo.insertSignupGrant(db, user.id);
    const game = await gamesRepo.insert(db, {
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
    const analysis = await analysesRepo.insertQueued(db, game.id);
    await analysesRepo.markReady(db, analysis.id, PLAN);
    return { user, game };
  }

  function headersFor(user: { email: string; displayName: string }) {
    return { 'x-auth-request-email': user.email, 'x-auth-request-user': user.displayName };
  }

  function coachAgentDeps(model: MockLanguageModelV1): CoachAgentDependencies {
    const gatewayConfig: GatewayConfig = {
      keyVault,
      platformKeys: { anthropic: 'platform-key' },
      modelIds: {
        standard: { anthropic: 'claude-standard', openai: 'gpt-standard' },
        light: { anthropic: 'claude-light', openai: 'gpt-light' }
      }
    };
    return {
      db,
      jobQueue: { enqueueAnalyzeGame: vi.fn(), enqueueSummarizeSession: vi.fn() },
      gatewayConfig,
      analyzePosition: vi.fn().mockResolvedValue({
        ply: 0,
        fen: 'startpos',
        depth: 10,
        lines: [{ moveUci: 'e2e4', moveSan: 'e4', cp: 20, mateIn: null }]
      } satisfies EngineEval),
      callLightModel: vi.fn().mockResolvedValue('engine says the position is roughly equal.'),
      resolveModel: () => Promise.resolve({ model, metered: true, provider: 'anthropic', modelId: 'claude-standard' })
    };
  }

  test('POST /api/sessions 409s when the analysis is not ready', async () => {
    const user = await usersRepo.insert(db, { email: 'notready@example.com', displayName: 'NR' });
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
    await analysesRepo.insertQueued(db, game.id);
    const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(textStreamModel('x').model) });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: headersFor(user),
      payload: { gameId: game.id }
    });

    expect(response.statusCode).toBe(409);
  });

  test('POST /api/sessions creates a session and synthesizes [session_start]', async () => {
    const { user, game } = await setupReadyGame('start@example.com');
    const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(textStreamModel('x').model) });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: headersFor(user),
      payload: { gameId: game.id }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('active');
    expect(body.currentPly).toBe(0);

    const messages = await sessionMessagesRepo.listBySession(db, body.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('[session_start]');
  });

  test('GET /api/sessions/:id returns messages and currentPly', async () => {
    const { user, game } = await setupReadyGame('get@example.com');
    const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(textStreamModel('x').model) });
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: headersFor(user),
      payload: { gameId: game.id }
    });
    const sessionId = created.json().id;

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
      headers: headersFor(user)
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().currentPly).toBe(0);
    expect(response.json().messages).toHaveLength(1);
  });

  test('GET /api/sessions/:id filters update_threads tool frames out of the client payload (backstage only)', async () => {
    const { user, game } = await setupReadyGame('threads-backstage@example.com');
    const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(textStreamModel('x').model) });
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: headersFor(user),
      payload: { gameId: game.id }
    });
    const sessionId = created.json().id;

    await sessionMessagesRepo.insert(db, sessionId, 'assistant', [
      { type: 'text', text: 'Hold on, one sec.' },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'update_threads', args: { threads: [] } }
    ]);
    await sessionMessagesRepo.insert(db, sessionId, 'tool', [
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'update_threads', result: [] }
    ]);
    await sessionMessagesRepo.insert(db, sessionId, 'assistant', 'Anyway, back to the game.');

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
      headers: headersFor(user)
    });

    const messages = response.json().messages as Array<{ content: unknown }>;
    expect(JSON.stringify(messages)).not.toContain('update_threads');
    // session_start, the assistant's spoken text (tool-call part stripped),
    // the final assistant text — the pure tool-result frame is dropped entirely.
    expect(messages).toHaveLength(3);
    expect(JSON.stringify(messages)).toContain('Hold on, one sec.');
  });

  describe('POST /api/sessions/:id/messages', () => {
    test('the system prompt sent to the model contains the focus areas and the coaching plan', async () => {
      const { user, game } = await setupReadyGame('prompt@example.com');
      const { model, doStream } = textStreamModel('Hello!');
      const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(model) });
      const created = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: headersFor(user),
        payload: { gameId: game.id }
      });
      const sessionId = created.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        headers: headersFor(user),
        payload: { content: 'hi coach' }
      });

      expect(doStream).toHaveBeenCalledOnce();
      const options = doStream.mock.calls[0]?.[0] as { prompt: Array<{ role: string; content: unknown }> };
      const system = options.prompt.find((m) => m.role === 'system');
      const systemText = JSON.stringify(system);
      expect(systemText).toContain('What was your opponent threatening?'); // plan moment
      expect(systemText).toContain('none yet'); // empty-focus-areas fallback
    }, 15000);

    test('a show_position tool call appears in the SSE stream, and current_ply updates on the client tool-result round-trip', async () => {
      const { user, game } = await setupReadyGame('toolcall@example.com');
      const { model } = textStreamModel('Let me show you.', {
        toolCallId: 'call-1',
        toolName: 'show_position',
        args: { ply: 4 }
      });
      const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(model) });
      const created = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: headersFor(user),
        payload: { gameId: game.id }
      });
      const sessionId = created.json().id;

      const streamResponse = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        headers: headersFor(user),
        payload: { content: 'hi coach' }
      });
      expect(streamResponse.payload).toContain('show_position');

      await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        headers: headersFor(user),
        payload: { clientToolResult: { toolCallId: 'call-1', toolName: 'show_position', result: { ply: 4 } } }
      });

      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}`,
        headers: headersFor(user)
      });
      expect(getResponse.json().currentPly).toBe(4);
    }, 15000);

    test('a metered turn writes an llm_call_log row with the usage', async () => {
      const { user, game } = await setupReadyGame('metered@example.com');
      const { model } = textStreamModel('Hello!');
      const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(model) });
      const created = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: headersFor(user),
        payload: { gameId: game.id }
      });
      const sessionId = created.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        headers: headersFor(user),
        payload: { content: 'hi coach' }
      });

      const logs = await db.selectFrom('llmCallLog').selectAll().where('userId', '=', user.id).execute();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.purpose).toBe('coach_turn');
      expect(logs[0]?.inputTokens).toBe(500);
    }, 15000);

    test('a metered user with 0 balance gets 402 and the session is paused_no_credits', async () => {
      const { user, game } = await setupReadyGame('nocredits@example.com');
      // Spend the signup grant down to 0.
      await creditsRepo.insertUsageDebit(db, user.id, null, 100);
      const { model } = textStreamModel('Hello!');
      const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(model) });
      const created = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: headersFor(user),
        payload: { gameId: game.id }
      });
      const sessionId = created.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        headers: headersFor(user),
        payload: { content: 'hi coach' }
      });

      expect(response.statusCode).toBe(402);
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}`,
        headers: headersFor(user)
      });
      expect(getResponse.json().status).toBe('paused_no_credits');
    }, 15000);

    test('messages persist verbatim and replay identically on the next turn (cache invariant)', async () => {
      const { user, game } = await setupReadyGame('replay@example.com');
      const { model } = textStreamModel('First reply.');
      const app = buildApp({ authMode: 'proxy', db, coachAgentDeps: coachAgentDeps(model) });
      const created = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: headersFor(user),
        payload: { gameId: game.id }
      });
      const sessionId = created.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        headers: headersFor(user),
        payload: { content: 'hi coach' }
      });
      const afterFirstTurn = await sessionMessagesRepo.listBySession(db, sessionId);

      await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        headers: headersFor(user),
        payload: { content: 'a follow-up question' }
      });
      const afterSecondTurn = await sessionMessagesRepo.listBySession(db, sessionId);

      const replayedPrefix = afterSecondTurn.slice(0, afterFirstTurn.length);
      expect(replayedPrefix.map((m) => ({ role: m.role, content: m.content }))).toEqual(
        afterFirstTurn.map((m) => ({ role: m.role, content: m.content }))
      );
    }, 15000);
  });
});
