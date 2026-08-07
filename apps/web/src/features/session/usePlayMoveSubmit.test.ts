import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { usePlayMoveSubmit } from './usePlayMoveSubmit.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('usePlayMoveSubmit (architecture §14)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('on success, applies the committed move and sends the [player_move] chat message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ fen: 'fen-after', san: 'e4', ply: 1, quality: 'best' }));
    vi.stubGlobal('fetch', fetchMock);
    const sendMessage = vi.fn();
    const onPlayMoveCommitted = vi.fn();

    const { result } = renderHook(() => usePlayMoveSubmit('session-1', sendMessage, onPlayMoveCommitted));
    await act(async () => {
      await result.current.submit('e4', 'e2e4');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session-1/play-move',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ san: 'e4' }) })
    );
    expect(onPlayMoveCommitted).toHaveBeenCalledWith({ fen: 'fen-after', san: 'e4', ply: 1, quality: 'best' }, 'e2e4');
    expect(sendMessage).toHaveBeenCalledWith('[player_move] I played e4.');
    expect(result.current.error).toBeNull();
  });

  test('a 422 response sets error using the problem+json title, and never calls sendMessage/onPlayMoveCommitted', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ type: 'about:blank', title: 'Illegal move: e4', status: 422 }, 422));
    vi.stubGlobal('fetch', fetchMock);
    const sendMessage = vi.fn();
    const onPlayMoveCommitted = vi.fn();

    const { result } = renderHook(() => usePlayMoveSubmit('session-1', sendMessage, onPlayMoveCommitted));
    await act(async () => {
      await result.current.submit('e4', 'e2e4');
    });

    await waitFor(() => expect(result.current.error).toBe('Illegal move: e4'));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onPlayMoveCommitted).not.toHaveBeenCalled();
  });

  test('a subsequent successful submit clears a prior error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ type: 'about:blank', title: 'Illegal move: e4', status: 422 }, 422))
      .mockResolvedValueOnce(jsonResponse({ fen: 'fen-after', san: 'd4', ply: 1, quality: 'best' }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayMoveSubmit('session-1', vi.fn()));
    await act(async () => {
      await result.current.submit('e4', 'e2e4');
    });
    expect(result.current.error).toBe('Illegal move: e4');

    await act(async () => {
      await result.current.submit('d4', 'd2d4');
    });
    expect(result.current.error).toBeNull();
  });
});
