import type { CoachingPlan, EngineEval } from '@chess-coach/shared';
import { MockLanguageModelV1 } from 'ai/test';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as creditsRepo from '../db/repositories/credits.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { createKeyVault } from '../llm/key-vault.js';
import type { GatewayConfig } from '../llm/gateway.js';
import * as coachAgent from './coach-agent.js';
import type { CoachAgentDependencies } from './coach-agent.js';

const PLAN: CoachingPlan = {
  gameSummary: 'A sharp game.',
  openingNote: 'Fine.',
  themes: ['king_safety'],
  connectionToHistory: 'First session together.',
  moments: []
};

const PGN = `[Event "Test"]
[White "Ann"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

/** Same shape as sessions.test.ts's textStreamModel helper, but exposes the
 * ReadableStreamDefaultController so the test can control exactly when the
 * mocked model "finishes" generating — the trigger for onFinish. */
function controllableStreamModel(text: string, toolCall: { toolCallId: string; toolName: string; args: unknown }) {
  let controllerRef: ReadableStreamDefaultController | undefined;
  const doStream = vi.fn().mockImplementation((options: unknown) =>
    Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          controllerRef = controller;
        }
      }),
      rawCall: { rawPrompt: options, rawSettings: {} }
    })
  );
  const model = new MockLanguageModelV1({ doStream });

  const finish = async (): Promise<void> => {
    while (!controllerRef) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    controllerRef.enqueue({ type: 'text-delta', textDelta: text });
    controllerRef.enqueue({
      type: 'tool-call',
      toolCallType: 'function',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: JSON.stringify(toolCall.args)
    });
    controllerRef.enqueue({
      type: 'finish',
      finishReason: 'tool-calls',
      usage: { promptTokens: 500, completionTokens: 50 }
    });
    controllerRef.close();
  };

  return { model, finish };
}

/** Instantly-resolving model for the turn after the client tool-result — its
 * stream finishes synchronously so drain() never blocks on it. */
function instantTextModel(text: string) {
  const doStream = vi.fn().mockImplementation((options: unknown) =>
    Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', textDelta: text });
          controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } });
          controller.close();
        }
      }),
      rawCall: { rawPrompt: options, rawSettings: {} }
    })
  );
  return new MockLanguageModelV1({ doStream });
}

async function drain(result: { fullStream: AsyncIterable<unknown> }): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _part of result.fullStream) {
    // consume so the AI SDK actually processes the stream through to onFinish
  }
}

describe('coach-agent startTurn concurrency', () => {
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

  function deps(model: MockLanguageModelV1): CoachAgentDependencies {
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
      callLightModel: vi.fn().mockResolvedValue('roughly equal.'),
      resolveModel: () => Promise.resolve({ model, metered: true, provider: 'anthropic', modelId: 'claude-standard' })
    };
  }

  test('a client tool-result turn started before the prior turn finishes persisting still sees its tool-call in history (no reordering race)', async () => {
    const user = await usersRepo.insert(db, { email: 'race@example.com', displayName: 'Race' });
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
    const session = await coachAgent.createSession(db, user.id, game.id);

    const { model, finish } = controllableStreamModel('Let me show you.', {
      toolCallId: 'call-race-1',
      toolName: 'show_position',
      args: { moveNumber: 2, color: 'black' }
    });

    // Gate turn 1's onFinish persistence of its own assistant/tool-call
    // message — this is the exact window (seen live in production) where the
    // client's tool-result round-trip can race ahead and read the session's
    // history before that message exists.
    const originalInsert = sessionMessagesRepo.insert;
    let releaseAssistantInsert: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseAssistantInsert = resolve;
    });
    vi.spyOn(sessionMessagesRepo, 'insert').mockImplementation(async (db2, sessionId, role, content) => {
      if (role === 'assistant' && JSON.stringify(content).includes('call-race-1')) {
        await gate;
      }
      return originalInsert(db2, sessionId, role, content);
    });

    const turn1 = await coachAgent.startTurn(deps(model), session, { content: 'hi coach' });
    const drainPromise = drain(turn1);
    void finish();

    // Fire the client-tool-result turn without waiting for turn 1's onFinish
    // to have released the gate above — mirrors the browser posting the
    // result the instant the tool-call SSE part streams in.
    const turn2Promise = coachAgent.startTurn(deps(instantTextModel('Got it.')), session, {
      clientToolResult: { toolCallId: 'call-race-1', toolName: 'show_position', result: { ply: 4 } }
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    releaseAssistantInsert();

    const turn2 = await turn2Promise;
    await Promise.all([drainPromise, drain(turn2)]);

    vi.restoreAllMocks();

    const messages = await sessionMessagesRepo.listBySession(db, session.id);
    const toolCallIndex = messages.findIndex(
      (m) => m.role === 'assistant' && JSON.stringify(m.content).includes('"toolCallId":"call-race-1"')
    );
    const toolResultIndex = messages.findIndex(
      (m) => m.role === 'tool' && JSON.stringify(m.content).includes('"toolCallId":"call-race-1"')
    );

    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndex).toBeGreaterThan(toolCallIndex);
  }, 15000);

  test("a metered turn's llm_call_log inputTokens covers fresh + cache-read tokens (matches computeCredits' total-input expectation)", async () => {
    const user = await usersRepo.insert(db, { email: 'usage-shape@example.com', displayName: 'Ann' });
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
    const session = await coachAgent.createSession(db, user.id, game.id);

    const doStream = vi.fn().mockImplementation((options: unknown) =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-delta', textDelta: 'Hello!' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { promptTokens: 400, completionTokens: 50 },
              providerMetadata: { anthropic: { cacheCreationInputTokens: 0, cacheReadInputTokens: 2000 } }
            });
            controller.close();
          }
        }),
        rawCall: { rawPrompt: options, rawSettings: {} }
      })
    );
    const model = new MockLanguageModelV1({ doStream });

    const turn = await coachAgent.startTurn(deps(model), session, { content: 'hi coach' });
    await drain(turn);

    const logs = await db.selectFrom('llmCallLog').selectAll().where('userId', '=', user.id).execute();
    expect(logs).toHaveLength(1);
    // 400 fresh + 2000 cache-read, not the raw promptTokens (400) alone.
    expect(logs[0]?.inputTokens).toBe(2400);
    expect(logs[0]?.cachedInputTokens).toBe(2000);
  }, 15000);

  test('a show_position client tool-result is persisted with a server-verified fen, not just the client-reported ply — the coach\'s only ground truth for what it just showed', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
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
    const session = await coachAgent.createSession(db, user.id, game.id);

    const turn = await coachAgent.startTurn(deps(instantTextModel('Got it.')), session, {
      clientToolResult: {
        toolCallId: 'call-fen-1',
        toolName: 'show_position',
        result: { moveNumber: 2, color: 'black', ply: 4 }
      }
    });
    await drain(turn);

    const messages = await sessionMessagesRepo.listBySession(db, session.id);
    const toolResultMessage = messages.find(
      (m) => m.role === 'tool' && JSON.stringify(m.content).includes('call-fen-1')
    );
    const content = toolResultMessage?.content as Array<{ result: unknown }>;
    expect(content[0]?.result).toEqual({
      moveNumber: 2,
      color: 'black',
      ply: 4,
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3'
    });
  }, 15000);

  test('a show_position tool-call and its later-confirmed tool-result stay in the same episode — no orphaned tool_result once the position moves', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
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
    await analysesRepo.storeClassifiedMoves(db, analysis.id, []);
    const session = await coachAgent.createSession(db, user.id, game.id);

    // Turn 1: the model itself calls show_position — no clientToolResult
    // input yet, this is the coach DECIDING to move, before any client
    // round-trip. currentPly is still 0 when this turn starts.
    const { model: showModel, finish: showFinish } = controllableStreamModel('Let me show you.', {
      toolCallId: 'call-show-1',
      toolName: 'show_position',
      args: { moveNumber: 2, color: 'black' }
    });
    const turn1 = await coachAgent.startTurn(deps(showModel), session, { content: 'hi coach' });
    const drain1 = drain(turn1);
    void showFinish();
    await drain1;

    // Turn 2: the client confirms the move actually happened.
    const turn2 = await coachAgent.startTurn(deps(instantTextModel('Here it is.')), session, {
      clientToolResult: { toolCallId: 'call-show-1', toolName: 'show_position', result: { moveNumber: 2, color: 'black', ply: 4 } }
    });
    await drain(turn2);

    // Turn 3: an ordinary follow-up in the same (now-current) episode. This is
    // the turn whose request would break if the tool-call landed in a
    // different episode than its tool-result.
    const turn3 = await coachAgent.startTurn(deps(instantTextModel('Sure.')), session, { content: 'what about here?' });
    await drain(turn3);

    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    const conversation = (snapshot?.request.messages ?? []).filter((m) => (m as { role: string }).role !== 'system');

    // The episode's first message must be the assistant's tool-call, never a
    // bare tool-result with no matching tool-call earlier in the same request
    // — that shape is what real Anthropic/OpenAI requests reject.
    expect(conversation[0]).toMatchObject({ role: 'assistant' });
    const firstToolResultIndex = conversation.findIndex((m) => (m as { role: string }).role === 'tool');
    expect(firstToolResultIndex).toBeGreaterThan(0);
  }, 20000);

  test('a jump back to an earlier move closes the old episode into a note and the new turn\'s request excludes that episode\'s raw messages', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
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
    await analysesRepo.storeClassifiedMoves(db, analysis.id, []);
    const session = await coachAgent.createSession(db, user.id, game.id);

    // Turn 1: coach shows move 2 for white (ply 3) and talks about it.
    const moveTurn = await coachAgent.startTurn(deps(instantTextModel('Talking about move 2.')), session, {
      clientToolResult: { toolCallId: 'call-1', toolName: 'show_position', result: { moveNumber: 2, color: 'white', ply: 3 } }
    });
    await drain(moveTurn);

    // Turn 2: student jumps back to the game start and sends a message.
    const jumpTurn = await coachAgent.startTurn(deps(instantTextModel('Sure, back at the start.')), session, {
      content: '[position_context] Back at move 0 (white), after start: what about a different opening?'
    });
    await drain(jumpTurn);

    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    const requestMessages = JSON.stringify(snapshot?.request.messages);

    expect(requestMessages).not.toContain('Talking about move 2.');
    expect(requestMessages).toContain('different opening');

    const note = await db
      .selectFrom('sessionMoveNotes')
      .selectAll()
      .where('sessionId', '=', session.id)
      .where('ply', '=', 3)
      .executeTakeFirst();
    expect(note).toBeDefined();
  }, 20000);

  test('a resumed session (fresh deps, no in-memory state) reconstructs the same five-layer request purely from the DB', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
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
    await analysesRepo.storeClassifiedMoves(db, analysis.id, []);
    const session = await coachAgent.createSession(db, user.id, game.id);

    const turn1 = await coachAgent.startTurn(deps(instantTextModel('Hello!')), session, { content: 'hi coach' });
    await drain(turn1);

    // Simulate a fresh process picking up the same session: a brand-new deps
    // object, no closures or caches carried over from turn 1.
    const turn2 = await coachAgent.startTurn(deps(instantTextModel('Welcome back.')), session, { content: 'hi again' });
    await drain(turn2);

    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    const [systemStatic, systemDynamic, systemPgn, systemOther, systemCurrent] = snapshot?.request.messages ?? [];
    expect(systemStatic).toMatchObject({ role: 'system' });
    expect(systemDynamic).toMatchObject({ role: 'system' });
    expect(systemPgn).toMatchObject({ role: 'system' });
    expect(systemOther).toMatchObject({ role: 'system' });
    expect(systemCurrent).toMatchObject({ role: 'system' });
  }, 20000);
});

describe('normalizeUsage', () => {
  test('anthropic: fresh input is promptTokens as-is (already fresh-only); cache stats come from providerMetadata.anthropic', () => {
    const usage = coachAgent.normalizeUsage(
      'anthropic',
      { promptTokens: 412, completionTokens: 186 },
      { anthropic: { cacheCreationInputTokens: 0, cacheReadInputTokens: 2180 } }
    );
    expect(usage).toEqual({
      freshInputTokens: 412,
      cacheReadTokens: 2180,
      cacheWriteTokens: 0,
      outputTokens: 186
    });
  });

  test('anthropic: missing providerMetadata.anthropic defaults cache stats to 0, not undefined', () => {
    const usage = coachAgent.normalizeUsage('anthropic', { promptTokens: 100, completionTokens: 20 }, undefined);
    expect(usage).toEqual({ freshInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20 });
  });

  test('openai: promptTokens already includes cached tokens, so freshInputTokens subtracts cachedPromptTokens out', () => {
    const usage = coachAgent.normalizeUsage(
      'openai',
      { promptTokens: 2592, completionTokens: 186 },
      { openai: { cachedPromptTokens: 2180 } }
    );
    expect(usage).toEqual({
      freshInputTokens: 412,
      cacheReadTokens: 2180,
      cacheWriteTokens: null,
      outputTokens: 186
    });
  });

  test('openai: cacheWriteTokens is null (not 0) — OpenAI has no cache-write concept, and null must never be displayed as "nothing cached"', () => {
    const usage = coachAgent.normalizeUsage('openai', { promptTokens: 100, completionTokens: 20 }, undefined);
    expect(usage.cacheWriteTokens).toBeNull();
    expect(usage).toEqual({ freshInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: null, outputTokens: 20 });
  });

  test('a NaN usage number (seen live from OpenAI on multi-step tool-calling turns) sanitizes to 0, not a JSON-null that would fail the frontend schema', () => {
    const usage = coachAgent.normalizeUsage('openai', { promptTokens: NaN, completionTokens: NaN }, undefined);
    expect(usage).toEqual({ freshInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: null, outputTokens: 0 });
    expect(JSON.parse(JSON.stringify(usage))).toEqual(usage);
  });
});

