import { describe, expect, test } from 'vitest';
import {
  findSuccessfulToolResult,
  isToolCallPart,
  isToolResultPart,
  toolCallId,
  toolCallInput,
  toolResultValue,
  upgradeStoredParts
} from './tool-parts.js';

// The shape written by the AI SDK version this project used before the v7
// upgrade. `session_messages` is append-only, so these rows exist forever.
const LEGACY_TOOL_CALL = {
  type: 'tool-call',
  toolCallId: 'call-1',
  toolName: 'show_position',
  args: { moveNumber: 2, color: 'black' }
};
const LEGACY_TOOL_RESULT = {
  type: 'tool-result',
  toolCallId: 'call-1',
  toolName: 'show_position',
  result: { ply: 4, fen: 'some-fen' }
};

const CURRENT_TOOL_CALL = {
  type: 'tool-call',
  toolCallId: 'call-1',
  toolName: 'show_position',
  input: { moveNumber: 2, color: 'black' }
};
const CURRENT_TOOL_RESULT = {
  type: 'tool-result',
  toolCallId: 'call-1',
  toolName: 'show_position',
  output: { type: 'json', value: { ply: 4, fen: 'some-fen' } }
};

describe('reading stored tool parts', () => {
  test('a tool call\'s arguments read the same under either field name', () => {
    expect(toolCallInput(LEGACY_TOOL_CALL)).toEqual({ moveNumber: 2, color: 'black' });
    expect(toolCallInput(CURRENT_TOOL_CALL)).toEqual({ moveNumber: 2, color: 'black' });
  });

  test('a tool result\'s payload reads the same whether or not it is wrapped in the output union', () => {
    expect(toolResultValue(LEGACY_TOOL_RESULT)).toEqual({ ply: 4, fen: 'some-fen' });
    expect(toolResultValue(CURRENT_TOOL_RESULT)).toEqual({ ply: 4, fen: 'some-fen' });
  });

  test('part predicates and ids work on both shapes', () => {
    for (const part of [LEGACY_TOOL_CALL, CURRENT_TOOL_CALL]) {
      expect(isToolCallPart(part)).toBe(true);
      expect(isToolCallPart(part, 'show_position')).toBe(true);
      expect(isToolCallPart(part, 'annotate_board')).toBe(false);
      expect(toolCallId(part)).toBe('call-1');
    }
    expect(isToolResultPart(LEGACY_TOOL_RESULT)).toBe(true);
    expect(isToolResultPart(CURRENT_TOOL_RESULT)).toBe(true);
  });

  test('non-object and non-array input is handled without throwing', () => {
    expect(toolCallInput('a plain string message')).toBeUndefined();
    expect(toolResultValue(null)).toBeUndefined();
    expect(upgradeStoredParts('a plain string message')).toBe('a plain string message');
  });
});

describe('findSuccessfulToolResult (architecture §14: play_coach_move / undo_last_move)', () => {
  test('returns the successful result\'s value, correlated by toolCallId', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'play_coach_move', input: { san: 'e4' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'play_coach_move', output: { type: 'json', value: { fen: 'f', san: 'e4', ply: 6, quality: 'best' } } }] }
    ];
    expect(findSuccessfulToolResult(messages, 'play_coach_move')).toEqual({ fen: 'f', san: 'e4', ply: 6, quality: 'best' });
  });

  test('returns null when the tool was never called this turn', () => {
    const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }];
    expect(findSuccessfulToolResult(messages, 'play_coach_move')).toBeNull();
  });

  test('returns null for an { error } result — an illegal move must never advance the ply', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'play_coach_move', input: { san: 'Z9' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'play_coach_move', output: { type: 'json', value: { error: 'Illegal move: Z9' } } }] }
    ];
    expect(findSuccessfulToolResult(messages, 'play_coach_move')).toBeNull();
  });

  test('ignores a same-name tool-result from a different toolCallId', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'play_coach_move', input: { san: 'e4' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c2', toolName: 'play_coach_move', output: { type: 'json', value: { fen: 'f', ply: 6 } } }] }
    ];
    expect(findSuccessfulToolResult(messages, 'play_coach_move')).toBeNull();
  });
});

describe('upgradeStoredParts', () => {
  // Without this, every session that existed before the upgrade would be
  // permanently unusable: the provider rejects the old part shapes, so the
  // rejection recurs on every replay of that session's history.
  test('rewrites a pre-upgrade tool call to the current field name', () => {
    expect(upgradeStoredParts([LEGACY_TOOL_CALL])).toEqual([CURRENT_TOOL_CALL]);
  });

  test('wraps a pre-upgrade tool result in the tagged output union', () => {
    expect(upgradeStoredParts([LEGACY_TOOL_RESULT])).toEqual([CURRENT_TOOL_RESULT]);
  });

  test('leaves parts already in the current shape untouched', () => {
    expect(upgradeStoredParts([CURRENT_TOOL_CALL, CURRENT_TOOL_RESULT])).toEqual([
      CURRENT_TOOL_CALL,
      CURRENT_TOOL_RESULT
    ]);
  });

  test('leaves text parts alone', () => {
    const text = [{ type: 'text', text: 'hello' }];
    expect(upgradeStoredParts(text)).toEqual(text);
  });

  test('a legacy result of null becomes an explicit json null, not an absent value', () => {
    const upgraded = upgradeStoredParts([{ type: 'tool-result', toolCallId: 'c', toolName: 't', result: null }]);
    expect(upgraded).toEqual([
      { type: 'tool-result', toolCallId: 'c', toolName: 't', output: { type: 'json', value: null } }
    ]);
  });
});
