import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useDivergedLine } from './useDivergedLine.js';

const REAL = { ply: 4, fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3' };

const MOVE_A = { san: 'Bc4', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3', uci: 'f1c4' };
const MOVE_B = { san: 'Nf6', fen: 'FEN_B', uci: 'g8f6' };
const MOVE_C = { san: 'Ng5', fen: 'FEN_C', uci: 'f3g5' };

describe('useDivergedLine', () => {
  test('starts inactive: no line, no fen, not expecting a move', () => {
    const { result } = renderHook(() => useDivergedLine());

    expect(result.current.line).toBeNull();
    expect(result.current.fen).toBeNull();
    expect(result.current.expectingMove).toBe(false);
  });

  test('appendMove starts a line from the given real position', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });

    expect(result.current.line).toEqual({ basePly: REAL.ply, baseFen: REAL.fen, moves: [MOVE_A] });
    expect(result.current.fen).toBe(MOVE_A.fen);
    expect(result.current.stepIndex).toBe(1);
  });

  test('a second appendMove extends the existing line', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });
    act(() => {
      result.current.appendMove(MOVE_B, REAL);
    });

    expect(result.current.line?.moves).toEqual([MOVE_A, MOVE_B]);
    expect(result.current.fen).toBe(MOVE_B.fen);
  });

  test('stepping back then appending a different move truncates the tail', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });
    act(() => {
      result.current.appendMove(MOVE_B, REAL);
    });
    act(() => {
      result.current.previewStep(1);
    });
    act(() => {
      result.current.appendMove(MOVE_C, REAL);
    });

    expect(result.current.line?.moves).toEqual([MOVE_A, MOVE_C]);
    expect(result.current.fen).toBe(MOVE_C.fen);
  });

  test('undoLastMove pops the most recent move off the line', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });
    act(() => {
      result.current.appendMove(MOVE_B, REAL);
    });
    act(() => {
      result.current.undoLastMove();
    });

    expect(result.current.line?.moves).toEqual([MOVE_A]);
    expect(result.current.stepIndex).toBe(1);
  });

  test('undoLastMove exits entirely when it removes the only move', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });
    act(() => {
      result.current.undoLastMove();
    });

    expect(result.current.line).toBeNull();
    expect(result.current.stepIndex).toBe(0);
  });

  test('exit clears the line, step index, and expecting-move flag', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
      result.current.handleToolCall({ toolCallId: '1', toolName: 'expect_move', args: {} }, REAL);
    });
    act(() => {
      result.current.exit();
    });

    expect(result.current.line).toBeNull();
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.expectingMove).toBe(false);
  });

  test('expect_move arms expectingMove and consumeExpectingMove is one-shot', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.handleToolCall({ toolCallId: '1', toolName: 'expect_move', args: {} }, REAL);
    });
    expect(result.current.expectingMove).toBe(true);

    act(() => {
      result.current.consumeExpectingMove();
    });
    expect(result.current.expectingMove).toBe(false);
  });

  test('hypothetical_line starts a new line from the real position when none is active', () => {
    const { result } = renderHook(() => useDivergedLine());

    let toolResult: unknown;
    act(() => {
      toolResult = result.current.handleToolCall(
        { toolCallId: '1', toolName: 'hypothetical_line', args: { moves: ['a4'] } },
        REAL
      );
    });

    expect(result.current.line?.basePly).toBe(REAL.ply);
    expect(result.current.line?.moves).toHaveLength(1);
    expect(result.current.line?.moves[0]?.san).toBe('a4');
    expect(toolResult).toEqual({
      ok: true,
      basePly: REAL.ply,
      moves: [{ san: 'a4' }],
      resultFen: result.current.line?.moves[0]?.fen
    });
  });

  test('hypothetical_line extends an already-active line instead of restarting it', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });
    act(() => {
      result.current.handleToolCall({ toolCallId: '1', toolName: 'hypothetical_line', args: { moves: ['Nf6'] } }, REAL);
    });

    expect(result.current.line?.moves).toHaveLength(2);
    expect(result.current.line?.moves[0]).toEqual(MOVE_A);
    expect(result.current.line?.moves[1]?.san).toBe('Nf6');
  });

  test('hypothetical_line with an illegal move reports failure and does not mutate an existing line', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });

    let toolResult: unknown;
    act(() => {
      toolResult = result.current.handleToolCall(
        { toolCallId: '1', toolName: 'hypothetical_line', args: { moves: ['Zz9'] } },
        REAL
      );
    });

    expect(result.current.line?.moves).toEqual([MOVE_A]);
    expect(toolResult).toEqual({ ok: false, basePly: REAL.ply, moves: [], error: expect.any(String) });
  });

  test('a real show_position tool call exits any open hypothetical', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });
    let toolResult: unknown;
    act(() => {
      toolResult = result.current.handleToolCall(
        { toolCallId: '1', toolName: 'show_position', args: { moveNumber: 2, color: 'black' } },
        REAL
      );
    });

    expect(result.current.line).toBeNull();
    expect(toolResult).toBeUndefined();
  });

  test('an unrelated tool call (e.g. annotate_board) is a no-op — it must not silently close the line', () => {
    const { result } = renderHook(() => useDivergedLine());

    act(() => {
      result.current.appendMove(MOVE_A, REAL);
    });
    act(() => {
      result.current.handleToolCall({ toolCallId: '1', toolName: 'annotate_board', args: {} }, REAL);
    });

    expect(result.current.line?.moves).toEqual([MOVE_A]);
  });
});
