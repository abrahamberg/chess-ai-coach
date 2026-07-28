import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useSessionBoardState } from './useSessionBoardState.js';

const POSITIONS = [
  { ply: 0, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { ply: 4, fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3' }
];

describe('useSessionBoardState', () => {
  test('starts at ply 0, undocked, no annotations', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    expect(result.current.fen).toBe(POSITIONS[0]?.fen);
    expect(result.current.isDocked).toBe(false);
    expect(result.current.arrows).toEqual([]);
  });

  test('a show_position tool call updates the fen, clears annotations, and expands a docked board', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));
    act(() => {
      result.current.setAnnotations({ arrows: [{ from: 'e2', to: 'e4', color: '#c9762a' }], highlights: [] });
      result.current.collapseDock();
    });
    expect(result.current.isDocked).toBe(true);
    expect(result.current.arrows).toHaveLength(1);

    let toolResult: unknown;
    act(() => {
      toolResult = result.current.handleToolCall({ toolCallId: '1', toolName: 'show_position', args: { ply: 4 } });
    });

    expect(result.current.fen).toBe(POSITIONS[1]?.fen);
    expect(result.current.arrows).toEqual([]);
    expect(result.current.isDocked).toBe(false);
    expect(toolResult).toEqual({ ply: 4 });
  });

  test('an annotate_board tool call sets arrows/highlights and returns a result (client tool round-trip)', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    let toolResult: unknown;
    act(() => {
      toolResult = result.current.handleToolCall({
        toolCallId: '2',
        toolName: 'annotate_board',
        args: { arrows: [{ from: 'd1', to: 'd8', color: '#4a7fb5' }], highlights: [] }
      });
    });

    expect(result.current.arrows).toEqual([{ from: 'd1', to: 'd8', color: '#4a7fb5' }]);
    expect(toolResult).toBeDefined();
  });

  test('a server-executed tool (e.g. record_finding) returns undefined — no client round-trip', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    let toolResult: unknown;
    act(() => {
      toolResult = result.current.handleToolCall({ toolCallId: '3', toolName: 'record_finding', args: {} });
    });

    expect(toolResult).toBeUndefined();
  });

  test('peekAt moves the board locally into peek mode without touching the server', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.peekAt(4);
    });

    expect(result.current.fen).toBe(POSITIONS[1]?.fen);
    expect(result.current.mode).toBe('peek');
  });

  test('the next show_position snaps back to answer mode at the coach ply', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.peekAt(4);
    });
    act(() => {
      result.current.handleToolCall({ toolCallId: '4', toolName: 'show_position', args: { ply: 0 } });
    });

    expect(result.current.fen).toBe(POSITIONS[0]?.fen);
    expect(result.current.mode).toBe('answer');
  });
});
