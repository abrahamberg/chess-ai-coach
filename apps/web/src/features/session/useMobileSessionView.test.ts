import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { useMobileSessionView } from './useMobileSessionView.js';

function renderView(initialMessageCount = 1) {
  return renderHook(({ count }) => useMobileSessionView(count), { initialProps: { count: initialMessageCount } });
}

describe('useMobileSessionView', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('starts on the coach panel', () => {
    const { result } = renderView();
    expect(result.current.view).toBe('coach');
  });

  test('remembers the panel the student left on', () => {
    const first = renderView();
    act(() => first.result.current.showBoard());
    first.unmount();

    expect(renderView().result.current.view).toBe('board');
  });

  test('a message arriving while the board is showing raises the unread dot until the coach panel is read', () => {
    const { result, rerender } = renderView(1);
    act(() => result.current.showBoard());

    rerender({ count: 2 });
    expect(result.current.hasUnread).toBe(true);

    act(() => result.current.showCoach());
    expect(result.current.hasUnread).toBe(false);
  });

  test('the transcript loading after mount is where the student left off, not a new message', () => {
    // The session fetch resolves a render after mount, so the whole history
    // lands at once — on the board panel that must not read as unread.
    const { result, rerender } = renderView(0);
    act(() => result.current.showBoard());

    rerender({ count: 12 });

    expect(result.current.hasUnread).toBe(false);

    rerender({ count: 13 });
    expect(result.current.hasUnread).toBe(true);
  });

  test('messages arriving while the coach panel is showing never raise the dot', () => {
    const { result, rerender } = renderView(1);

    rerender({ count: 2 });

    expect(result.current.view).toBe('coach');
    expect(result.current.hasUnread).toBe(false);
  });
});
