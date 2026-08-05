import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useSessionBoardState } from './useSessionBoardState.js';

const POSITIONS = [
  { ply: 0, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moveUci: null },
  { ply: 4, fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', moveUci: 'g1f3' },
  { ply: 1, fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', moveUci: 'e2e4' }
];

// Contiguous plies (unlike POSITIONS above) so the pre-move anchor's ply-1
// lookup actually finds a position instead of falling back to the current one.
const ANCHOR_POSITIONS = [
  { ply: 0, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moveUci: null },
  { ply: 1, fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', moveUci: 'e2e4' },
  { ply: 2, fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', moveUci: 'e7e5' }
];

describe('useSessionBoardState', () => {
  test('starts at ply 0, undocked, no annotations', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    expect(result.current.fen).toBe(POSITIONS[0]?.fen);
    expect(result.current.isDocked).toBe(false);
    expect(result.current.arrows).toEqual([]);
  });

  test('the last-played move is highlighted automatically from the position data, no coach call needed', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    expect(result.current.highlights).toEqual([]);

    act(() => {
      result.current.peekAt(1);
    });

    expect(result.current.highlights).toEqual(
      expect.arrayContaining([
        { square: 'e2', color: 'var(--last-move)' },
        { square: 'e4', color: 'var(--last-move)' }
      ])
    );
  });

  test('a coach annotate_board highlight is layered on top of, not replaced by, the last-move highlight', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.peekAt(1);
    });
    act(() => {
      result.current.handleToolCall({
        toolCallId: '6',
        toolName: 'annotate_board',
        input: { arrows: [], highlights: [{ square: 'd5', color: '#4a7fb5' }] }
      });
    });

    expect(result.current.highlights).toEqual(
      expect.arrayContaining([
        { square: 'e2', color: 'var(--last-move)' },
        { square: 'e4', color: 'var(--last-move)' },
        { square: 'd5', color: '#4a7fb5' }
      ])
    );
  });

  test('reopening a session at a given initialPly starts the board there, and backToCoach returns to it', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS, 4));

    expect(result.current.fen).toBe(POSITIONS[1]?.fen);

    act(() => {
      result.current.peekAt(0);
    });
    expect(result.current.fen).toBe(POSITIONS[0]?.fen);

    act(() => {
      result.current.backToCoach();
    });
    expect(result.current.fen).toBe(POSITIONS[1]?.fen);
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
      toolResult = result.current.handleToolCall({
        toolCallId: '1',
        toolName: 'show_position',
        input: { moveNumber: 2, color: 'black' }
      });
    });

    expect(result.current.fen).toBe(POSITIONS[1]?.fen);
    // The old coach-drawn annotate_board arrow is cleared — the only arrow
    // left is the new auto pre-move red arrow for the move being discussed.
    expect(result.current.arrows).toEqual([{ from: 'g1', to: 'f3', color: 'var(--played-move)' }]);
    expect(result.current.isDocked).toBe(false);
    expect(toolResult).toEqual({ moveNumber: 2, color: 'black', ply: 4 });
  });

  test('an annotate_board tool call sets arrows/highlights and returns a result (client tool round-trip)', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    let toolResult: unknown;
    act(() => {
      toolResult = result.current.handleToolCall({
        toolCallId: '2',
        toolName: 'annotate_board',
        input: { arrows: [{ from: 'd1', to: 'd8', color: '#4a7fb5' }], highlights: [] }
      });
    });

    expect(result.current.arrows).toEqual([{ from: 'd1', to: 'd8', color: '#4a7fb5' }]);
    expect(toolResult).toBeDefined();
  });

  test('a server-executed tool (e.g. record_finding) returns undefined — no client round-trip', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    let toolResult: unknown;
    act(() => {
      toolResult = result.current.handleToolCall({ toolCallId: '3', toolName: 'record_finding', input: {} });
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

  test('design.md §5.4: backToCoach restores answer mode at the last coach-set ply, not wherever peek left off', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.handleToolCall({
        toolCallId: '5',
        toolName: 'show_position',
        input: { moveNumber: 0, color: null }
      });
    });
    act(() => {
      result.current.peekAt(4);
    });
    expect(result.current.mode).toBe('peek');

    act(() => {
      result.current.backToCoach();
    });

    expect(result.current.mode).toBe('answer');
    expect(result.current.fen).toBe(POSITIONS[0]?.fen);
  });

  test('previewMove immediately reflects a locally-dropped move (e.g. castling) without waiting on the server', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));
    const castledFen = 'r1bqk1nr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4';

    act(() => {
      result.current.previewMove(castledFen);
    });

    expect(result.current.fen).toBe(castledFen);
  });

  test('clearPreview reverts to the underlying position (e.g. after the user hits undo)', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.previewMove('some-preview-fen');
    });
    expect(result.current.fen).toBe('some-preview-fen');

    act(() => {
      result.current.clearPreview();
    });

    expect(result.current.fen).toBe(POSITIONS[0]?.fen);
  });

  test('a show_position tool call supersedes and clears any pending local preview', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.previewMove('some-preview-fen');
    });
    act(() => {
      result.current.handleToolCall({
        toolCallId: '7',
        toolName: 'show_position',
        input: { moveNumber: 2, color: 'black' }
      });
    });

    expect(result.current.fen).toBe(POSITIONS[1]?.fen);
  });

  test('peekAt navigation clears any pending local preview', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.previewMove('some-preview-fen');
    });
    act(() => {
      result.current.peekAt(1);
    });

    expect(result.current.fen).toBe(POSITIONS[2]?.fen);
  });

  test('anchorHere promotes the current peeked position to the coach position in place, without moving the board', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.peekAt(4);
    });
    expect(result.current.mode).toBe('peek');

    act(() => {
      result.current.anchorHere();
    });

    expect(result.current.mode).toBe('answer');
    expect(result.current.fen).toBe(POSITIONS[1]?.fen);

    // backToCoach should now be a no-op relative to this anchored ply — it
    // was already promoted, not reverted to the pre-peek coach position.
    act(() => {
      result.current.peekAt(1);
    });
    act(() => {
      result.current.backToCoach();
    });
    expect(result.current.fen).toBe(POSITIONS[1]?.fen);
  });

  test('the next show_position snaps back to answer mode at the coach ply', () => {
    const { result } = renderHook(() => useSessionBoardState(POSITIONS));

    act(() => {
      result.current.peekAt(4);
    });
    act(() => {
      result.current.handleToolCall({
        toolCallId: '4',
        toolName: 'show_position',
        input: { moveNumber: 0, color: null }
      });
    });

    expect(result.current.fen).toBe(POSITIONS[0]?.fen);
    expect(result.current.mode).toBe('answer');
  });
});

describe('pre-move anchor + red arrow (universal default, every student)', () => {
  test('a show_position landing on a real move anchors the board one ply before it, with a red arrow for the move played', () => {
    const { result } = renderHook(() => useSessionBoardState(ANCHOR_POSITIONS));

    act(() => {
      result.current.handleToolCall({
        toolCallId: '1',
        toolName: 'show_position',
        input: { moveNumber: 1, color: 'black' }
      });
    });

    expect(result.current.isAnchoredPreMove).toBe(true);
    expect(result.current.fen).toBe(ANCHOR_POSITIONS[1]?.fen);
    expect(result.current.arrows).toEqual([{ from: 'e7', to: 'e5', color: 'var(--played-move)' }]);
    expect(result.current.highlights).toEqual([]);
  });

  test('show_position to the game start (ply 0) never anchors — nothing to show before it', () => {
    const { result } = renderHook(() => useSessionBoardState(ANCHOR_POSITIONS));

    act(() => {
      result.current.handleToolCall({
        toolCallId: '1',
        toolName: 'show_position',
        input: { moveNumber: 0, color: null }
      });
    });

    expect(result.current.isAnchoredPreMove).toBe(false);
    expect(result.current.fen).toBe(ANCHOR_POSITIONS[0]?.fen);
    expect(result.current.arrows).toEqual([]);
  });

  test('revealPlayedMove shows the actual post-move position and its normal last-move highlight', () => {
    const { result } = renderHook(() => useSessionBoardState(ANCHOR_POSITIONS));

    act(() => {
      result.current.handleToolCall({
        toolCallId: '1',
        toolName: 'show_position',
        input: { moveNumber: 1, color: 'black' }
      });
    });
    act(() => {
      result.current.revealPlayedMove();
    });

    expect(result.current.isAnchoredPreMove).toBe(false);
    expect(result.current.fen).toBe(ANCHOR_POSITIONS[2]?.fen);
    expect(result.current.arrows).toEqual([]);
    expect(result.current.highlights).toEqual(
      expect.arrayContaining([
        { square: 'e7', color: 'var(--last-move)' },
        { square: 'e5', color: 'var(--last-move)' }
      ])
    );
  });

  test('backToCoach re-anchors pre-move for the coach position, discarding whatever reveal state peeking left behind', () => {
    const { result } = renderHook(() => useSessionBoardState(ANCHOR_POSITIONS));

    act(() => {
      result.current.handleToolCall({
        toolCallId: '1',
        toolName: 'show_position',
        input: { moveNumber: 1, color: 'black' }
      });
    });
    act(() => {
      result.current.revealPlayedMove();
    });
    act(() => {
      result.current.peekAt(0);
    });
    expect(result.current.mode).toBe('peek');

    act(() => {
      result.current.backToCoach();
    });

    expect(result.current.mode).toBe('answer');
    expect(result.current.isAnchoredPreMove).toBe(true);
    expect(result.current.fen).toBe(ANCHOR_POSITIONS[1]?.fen);
    expect(result.current.arrows).toEqual([{ from: 'e7', to: 'e5', color: 'var(--played-move)' }]);
  });

  test('anchorHere (promoting a peeked position) never anchors pre-move — the student already looked at exactly this position', () => {
    const { result } = renderHook(() => useSessionBoardState(ANCHOR_POSITIONS));

    act(() => {
      result.current.peekAt(2);
    });
    act(() => {
      result.current.anchorHere();
    });

    expect(result.current.mode).toBe('answer');
    expect(result.current.isAnchoredPreMove).toBe(false);
    expect(result.current.fen).toBe(ANCHOR_POSITIONS[2]?.fen);
  });

  test('a coach-drawn annotate_board arrow is layered after, not instead of, the pre-move red arrow', () => {
    const { result } = renderHook(() => useSessionBoardState(ANCHOR_POSITIONS));

    act(() => {
      result.current.handleToolCall({
        toolCallId: '1',
        toolName: 'show_position',
        input: { moveNumber: 1, color: 'black' }
      });
    });
    act(() => {
      result.current.handleToolCall({
        toolCallId: '2',
        toolName: 'annotate_board',
        input: { arrows: [{ from: 'g1', to: 'f3', color: '#4a7fb5' }], highlights: [] }
      });
    });

    expect(result.current.arrows).toEqual([
      { from: 'e7', to: 'e5', color: 'var(--played-move)' },
      { from: 'g1', to: 'f3', color: '#4a7fb5' }
    ]);
  });
});
