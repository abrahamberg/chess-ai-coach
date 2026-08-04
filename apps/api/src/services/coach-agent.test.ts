import type { CoachingPlan, PositionAnalysis } from '@chess-coach/shared';
import { EPISODE_FOLD_SYSTEM_PROMPT } from '@chess-coach/prompts';
import { MockLanguageModelV1 } from 'ai/test';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as creditsRepo from '../db/repositories/credits.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
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

/** A model that resolves each of `steps` synchronously in order — one
 * doStream() call per step. Used for turns where the model calls a
 * SERVER-executed tool (has an `execute`, e.g. record_move_note): the AI
 * SDK auto-runs the tool and then calls doStream() again for the model's
 * follow-up step, unlike client tools (show_position) which stop the turn
 * after the tool-call. */
function multiStepModel(
  steps: Array<{ text?: string; toolCall?: { toolCallId: string; toolName: string; args: unknown }; finishReason: string }>
) {
  let call = 0;
  const doStream = vi.fn().mockImplementation((options: unknown) => {
    const step = steps[call++];
    if (!step) throw new Error('multiStepModel: doStream called more times than steps provided');
    return Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          if (step.text) controller.enqueue({ type: 'text-delta', textDelta: step.text });
          if (step.toolCall) {
            controller.enqueue({
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: step.toolCall.toolCallId,
              toolName: step.toolCall.toolName,
              args: JSON.stringify(step.toolCall.args)
            });
          }
          controller.enqueue({
            type: 'finish',
            finishReason: step.finishReason,
            usage: { promptTokens: 10, completionTokens: 5 }
          });
          controller.close();
        }
      }),
      rawCall: { rawPrompt: options, rawSettings: {} }
    });
  });
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
        fen: 'startpos',
        depth: 10,
        multiPv: 1,
        bestMove: 'e4',
        eval: { cp: 20, mateIn: null },
        lines: [{ moveUci: 'e2e4', moveSan: 'e4', pvSan: ['e4'], cp: 20, mateIn: null }],
        features: {
          turn: 'white',
          boardState: 'none',
          availableMoves: ['e4'],
          mobility: { white: 20, black: 20 },
          controlledSquares: [],
          piecesUnderAttack: [],
          hangingPieces: [],
          underDefendedPieces: [],
          overloadedDefenders: [],
          centerControlScore: { white: 0, black: 0 },
          openFiles: [],
          semiOpenFiles: [],
          doubledPawns: [],
          isolatedPawns: [],
          passedPawns: [],
          targetsAttacked: [],
          forks: [],
          captureOpportunities: []
        }
      } satisfies PositionAnalysis),
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

  test('a stream-level provider error releases the session lock — a later turn does not hang forever', async () => {
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

    // No 'finish' part at all — mirrors a provider rejecting the request
    // mid-stream, the case where the AI SDK never calls onFinish.
    const doStream = vi.fn().mockImplementation((options: unknown) =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'error', error: new Error('provider rejected the request') });
            controller.close();
          }
        }),
        rawCall: { rawPrompt: options, rawSettings: {} }
      })
    );
    const erroringModel = new MockLanguageModelV1({ doStream });

    const turn1 = await coachAgent.startTurn(deps(erroringModel), session, { content: 'hi coach' });
    await drain(turn1);

    // If the lock leaked, this hangs until the test's own timeout fires.
    const turn2 = await coachAgent.startTurn(deps(instantTextModel('Still here.')), session, { content: 'hello?' });
    await drain(turn2);
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

    // Refetch between turns, matching what routes/sessions.ts actually does
    // in production (a fresh SessionRow per HTTP request) — this test proves
    // correctness purely from the DB, not from any in-memory session state.
    const sessionAfterTurn1 = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterTurn1) throw new Error('session not found');

    // Turn 2: the client confirms the move actually happened.
    const turn2 = await coachAgent.startTurn(deps(instantTextModel('Here it is.')), sessionAfterTurn1, {
      clientToolResult: { toolCallId: 'call-show-1', toolName: 'show_position', result: { moveNumber: 2, color: 'black', ply: 4 } }
    });
    await drain(turn2);

    const sessionAfterTurn2 = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterTurn2) throw new Error('session not found');

    // Turn 3: an ordinary follow-up in the same (now-current) episode. This is
    // the turn whose request would break if the tool-call landed in a
    // different episode than its tool-result.
    const turn3 = await coachAgent.startTurn(deps(instantTextModel('Sure.')), sessionAfterTurn2, {
      content: 'what about here?'
    });
    await drain(turn3);

    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    const conversation = (snapshot?.request.messages ?? []).filter((m) => (m as { role: string }).role !== 'system');

    // The episode's first message must be the assistant's tool-call, never a
    // bare tool-result with no matching tool-call earlier in the same request
    // — that shape is what real Anthropic/OpenAI requests reject.
    expect(conversation[0]).toMatchObject({ role: 'assistant' });
    const firstToolResultIndex = conversation.findIndex((m) => (m as { role: string }).role === 'tool');
    expect(firstToolResultIndex).toBeGreaterThan(0);

    // Finding 1 regression: the episode that closed when show_position was
    // confirmed (ply 0, the pre-move discussion) must have gotten an
    // automatic note — this used to silently no-op.
    const closedEpisodeNote = await db
      .selectFrom('sessionMoveNotes')
      .selectAll()
      .where('sessionId', '=', session.id)
      .where('ply', '=', 0)
      .executeTakeFirst();
    expect(closedEpisodeNote).toBeDefined();
  }, 20000);

  test('a show_position tool-call sharing an assistant step with another tool-call still reunites with its later-confirmed result (no orphaned tool_result even with a sibling tool-result in between)', async () => {
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

    // Turn 1: one assistant step makes TWO tool-calls — record_move_note
    // (server-executed, its result lands in the same turn) and show_position
    // (client-only, its result won't land until turn 2). This is the exact
    // shape seen in production: the server-executed tool's result sits
    // between the tool-call message and show_position's own later-confirmed
    // result, so the naive "check one message back" guard misses it.
    const doStream = vi.fn().mockImplementation((options: unknown) =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: 'call-note-1',
              toolName: 'record_move_note',
              args: JSON.stringify({ moveNumber: 1, color: 'white', note: 'Sharp opening.' })
            });
            controller.enqueue({
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: 'call-show-2',
              toolName: 'show_position',
              args: JSON.stringify({ moveNumber: 2, color: 'black' })
            });
            controller.enqueue({
              type: 'finish',
              finishReason: 'tool-calls',
              usage: { promptTokens: 10, completionTokens: 5 }
            });
            controller.close();
          }
        }),
        rawCall: { rawPrompt: options, rawSettings: {} }
      })
    );
    const model = new MockLanguageModelV1({ doStream });

    const turn1 = await coachAgent.startTurn(deps(model), session, { content: 'hi coach' });
    await drain(turn1);

    const sessionAfterTurn1 = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterTurn1) throw new Error('session not found');

    // Turn 2: the client confirms show_position's move, one turn later — the
    // tool-result lands at a new ply, after record_move_note's own result.
    const turn2 = await coachAgent.startTurn(deps(instantTextModel('Here it is.')), sessionAfterTurn1, {
      clientToolResult: { toolCallId: 'call-show-2', toolName: 'show_position', result: { moveNumber: 2, color: 'black', ply: 4 } }
    });
    await drain(turn2);

    const sessionAfterTurn2 = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterTurn2) throw new Error('session not found');

    // Turn 3: an ordinary follow-up — this is the turn whose request would
    // be rejected by a real provider if show_position's tool-result ended up
    // in a different episode than its own tool-call.
    const turn3 = await coachAgent.startTurn(deps(instantTextModel('Sure.')), sessionAfterTurn2, {
      content: 'what about here?'
    });
    await drain(turn3);

    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    const conversation = (snapshot?.request.messages ?? []).filter((m) => (m as { role: string }).role !== 'system');

    expect(conversation[0]).toMatchObject({ role: 'assistant' });
    const toolResultToolCallIds = conversation
      .filter((m) => (m as { role: string }).role === 'tool')
      .flatMap((m) => (m as { content: Array<{ toolCallId: string }> }).content.map((part) => part.toolCallId));
    expect(toolResultToolCallIds).toContain('call-show-2');
  }, 20000);

  test('showEngineAnalysis on the user row flows through to buildEpisodeContext — the request embeds the curated analysis summary, computed on the pre-move fen', async () => {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    await usersRepo.update(db, user.id, { showEngineAnalysis: true });
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

    const testDeps = deps(instantTextModel('Sure.'));
    const turn = await coachAgent.startTurn(testDeps, session, {
      clientToolResult: { toolCallId: 'call-1', toolName: 'show_position', result: { moveNumber: 1, color: 'white', ply: 1 } }
    });
    await drain(turn);

    expect(testDeps.analyzePosition).toHaveBeenCalledWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    // "You are now discussing" is unique to episode-context.ts's per-turn current-position
    // block — unlike the "## Current position" heading text alone, which a tool description
    // in the static system prompt may also legitimately quote (get_engine_analysis's).
    const currentPositionMessage = (snapshot?.request.messages ?? []).find(
      (m) => typeof (m as { content?: unknown }).content === 'string' && (m as { content: string }).content.includes('You are now discussing')
    ) as { content: string } | undefined;
    expect(currentPositionMessage?.content).toContain('This was the engine’s top choice.');
    expect(currentPositionMessage?.content).toContain('The move actually played here was e4');
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

    // Refetch between turns, matching what routes/sessions.ts actually does
    // in production (a fresh SessionRow per HTTP request).
    const sessionAfterMoveTurn = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterMoveTurn) throw new Error('session not found');

    // Turn 2: student jumps back to the game start and sends a message.
    const jumpTurn = await coachAgent.startTurn(deps(instantTextModel('Sure, back at the start.')), sessionAfterMoveTurn, {
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

  test('final review new test #2: a coach-authored record_move_note through the real tool path suppresses the auto-fallback when its episode closes', async () => {
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

    // Turn 1: the model calls record_move_note (a SERVER-executed tool —
    // buildCoachTools wires up a real execute, not a hand-constructed
    // message row) for the game start (moveNumber 0, color null), then
    // continues with a text reply once the tool result comes back.
    const recordModel = multiStepModel([
      {
        toolCall: {
          toolCallId: 'call-note-1',
          toolName: 'record_move_note',
          args: { moveNumber: 0, color: null, note: 'coach note: discussed the opening plan' }
        },
        finishReason: 'tool-calls'
      },
      { text: 'Noted — now, before we start...', finishReason: 'stop' }
    ]);
    const turn1 = await coachAgent.startTurn(deps(recordModel), session, { content: 'hi coach' });
    await drain(turn1);

    // The auto-fallback would use whatever callLightModel returns — give it
    // a distinctive, obviously-wrong value so the assertion below can tell
    // the two apart unambiguously.
    const agentDeps = deps(instantTextModel('Got it.'));
    agentDeps.callLightModel = vi.fn().mockResolvedValue('AUTO-FALLBACK NOTE — should never appear');

    const sessionAfterTurn1 = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterTurn1) throw new Error('session not found');

    // Turn 2: the position moves on (client confirms show_position), closing
    // the ply-0 episode that record_move_note was already called for.
    const turn2 = await coachAgent.startTurn(agentDeps, sessionAfterTurn1, {
      clientToolResult: { toolCallId: 'call-show-1', toolName: 'show_position', result: { moveNumber: 2, color: 'black', ply: 4 } }
    });
    await drain(turn2);

    expect(agentDeps.callLightModel).not.toHaveBeenCalled();

    const note = await db
      .selectFrom('sessionMoveNotes')
      .selectAll()
      .where('sessionId', '=', session.id)
      .where('ply', '=', 0)
      .executeTakeFirst();
    expect(note?.note).toBe('coach note: discussed the opening plan');
  }, 20000);

  test('final review new test #3: an AUTO-generated closing note (not a manual one) shows up in the other-moves-summary layer on the next turn', async () => {
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

    const agentDeps = deps(instantTextModel('Got it.'));
    const callLightModel = vi.fn().mockResolvedValue('AUTO NOTE: discussed the opening move order.');
    agentDeps.callLightModel = callLightModel;

    // Turn 1: ordinary discussion at the game start (ply 0) — no
    // record_move_note call, so closing this episode must fall back to the
    // automatic fold.
    const turn1 = await coachAgent.startTurn(agentDeps, session, { content: 'hi coach' });
    await drain(turn1);

    const sessionAfterTurn1 = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterTurn1) throw new Error('session not found');

    // Turn 2: the position moves on, closing the ply-0 episode into the
    // automatic note (no record_move_note was ever called for it).
    const turn2 = await coachAgent.startTurn(agentDeps, sessionAfterTurn1, {
      clientToolResult: { toolCallId: 'call-show-1', toolName: 'show_position', result: { moveNumber: 2, color: 'black', ply: 4 } }
    });
    await drain(turn2);

    // final review #4 regression: the auto-fold must use the short
    // per-episode prompt, not the whole-session COMPACTOR_SYSTEM_PROMPT.
    const calls = callLightModel.mock.calls as unknown as Array<[{ system: string; user: string }]>;
    const foldCall = calls.find(([prompt]) => prompt.system === EPISODE_FOLD_SYSTEM_PROMPT);
    expect(foldCall).toBeDefined();

    const sessionAfterTurn2 = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterTurn2) throw new Error('session not found');

    // Turn 3: an ordinary follow-up at the now-current ply — its request's
    // "Other moves discussed" layer (index 3) must include the AUTO note.
    const turn3 = await coachAgent.startTurn(deps(instantTextModel('Sure.')), sessionAfterTurn2, {
      content: 'what should I have played instead?'
    });
    await drain(turn3);

    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    const otherMovesLayer = snapshot?.request.messages[3] as { content: string } | undefined;
    expect(otherMovesLayer?.content).toContain('## Other moves discussed');
    expect(otherMovesLayer?.content).toContain('AUTO NOTE: discussed the opening move order.');
    expect(otherMovesLayer?.content).toContain('the game start');
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
    // object, no closures or caches carried over from turn 1 — and a
    // freshly-fetched SessionRow, matching what routes/sessions.ts actually
    // does in production (a fresh row per HTTP request).
    const sessionAfterTurn1 = await sessionsRepo.findById(db, session.id);
    if (!sessionAfterTurn1) throw new Error('session not found');
    const turn2 = await coachAgent.startTurn(deps(instantTextModel('Welcome back.')), sessionAfterTurn1, {
      content: 'hi again'
    });
    await drain(turn2);

    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    const [systemStatic, systemDynamic, systemPgn, systemOther, systemCurrent] = snapshot?.request.messages ?? [];
    expect(systemStatic).toMatchObject({ role: 'system' });
    expect(systemDynamic).toMatchObject({ role: 'system' });
    expect(systemPgn).toMatchObject({ role: 'system' });
    expect(systemOther).toMatchObject({ role: 'system' });
    expect(systemCurrent).toMatchObject({ role: 'system' });
  }, 20000);

  test('an out-of-range client-reported ply from show_position does not brick the session', async () => {
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

    // Claim a ply far beyond the game's actual length.
    const badTurn = await coachAgent.startTurn(deps(instantTextModel('Got it.')), session, {
      clientToolResult: { toolCallId: 'call-bad-1', toolName: 'show_position', result: { moveNumber: 999, color: 'white', ply: 1997 } }
    });
    await drain(badTurn);

    const refetched = await sessionsRepo.findById(db, session.id);
    expect(refetched?.currentPly).toBe(0);

    // The session must still work normally afterward.
    const followUp = await coachAgent.startTurn(deps(instantTextModel('Still here.')), session, { content: 'hello?' });
    await drain(followUp);
    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    expect(snapshot?.request.messages.length).toBeGreaterThan(0);
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

