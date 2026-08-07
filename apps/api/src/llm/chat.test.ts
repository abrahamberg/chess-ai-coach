import { z } from 'zod';
import { describe, expect, test } from 'vitest';
import { drain, mockResolution, multiStepModel } from '../../test/helpers/mock-model.js';
import { runCoachTurn } from './chat.js';
import { tool, type ToolSet } from './tools.js';
import type { StreamTimeouts } from './model-options.js';

const TIMEOUTS: StreamTimeouts = { firstChunkMs: 10000, chunkMs: 10000 };

function playCoachMoveTools(): ToolSet {
  return {
    play_coach_move: tool({
      inputSchema: z.object({ san: z.string() }),
      execute: async () => ({ fen: 'fen-after-move' })
    })
  };
}

/** architecture §14: play mode ends its turn the instant play_coach_move or
 * undo_last_move is called, via the SDK's hasToolCall stop condition, rather
 * than letting the SDK auto-continue with a follow-up step the way it
 * normally does for any other server-executed tool. */
describe('runCoachTurn — stopOnToolNames', () => {
  test('without stopOnToolNames, a server tool call is auto-followed by another step (today\'s analyze-mode behavior, unchanged)', async () => {
    const model = multiStepModel([
      { toolCall: { toolCallId: 't1', toolName: 'play_coach_move', input: { san: 'e4' } }, finishReason: 'tool-calls' },
      { text: 'Your move.', finishReason: 'stop' }
    ]);

    const turn = runCoachTurn({
      resolution: mockResolution(model),
      instructions: [],
      messages: [{ role: 'user', content: 'go' }],
      tools: playCoachMoveTools(),
      timeouts: TIMEOUTS,
      onFinish: async () => undefined,
      onError: () => undefined,
      onAbort: () => undefined
    });
    await drain(turn);

    expect(model.doStreamCalls.length).toBe(2);
  });

  test('with stopOnToolNames including the called tool, the turn ends at that step — no follow-up step is requested', async () => {
    const model = multiStepModel([
      { toolCall: { toolCallId: 't1', toolName: 'play_coach_move', input: { san: 'e4' } }, finishReason: 'tool-calls' },
      { text: 'Should never be reached.', finishReason: 'stop' }
    ]);

    const turn = runCoachTurn({
      resolution: mockResolution(model),
      instructions: [],
      messages: [{ role: 'user', content: 'go' }],
      tools: playCoachMoveTools(),
      timeouts: TIMEOUTS,
      stopOnToolNames: ['play_coach_move', 'undo_last_move'],
      onFinish: async () => undefined,
      onError: () => undefined,
      onAbort: () => undefined
    });
    await drain(turn);

    expect(model.doStreamCalls.length).toBe(1);
  });
});
