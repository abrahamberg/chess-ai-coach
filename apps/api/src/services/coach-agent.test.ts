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
});
