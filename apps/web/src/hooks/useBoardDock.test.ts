import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useBoardDock } from './useBoardDock.js';

describe('useBoardDock', () => {
  test('starts expanded', () => {
    const { result } = renderHook(() => useBoardDock());
    expect(result.current.isCollapsed).toBe(false);
  });

  test('collapse() docks the board to a mini-board', () => {
    const { result } = renderHook(() => useBoardDock());

    act(() => result.current.collapse());

    expect(result.current.isCollapsed).toBe(true);
  });

  test('expand() undocks it again (e.g. tapping the mini-board or a SAN chip)', () => {
    const { result } = renderHook(() => useBoardDock());

    act(() => result.current.collapse());
    act(() => result.current.expand());

    expect(result.current.isCollapsed).toBe(false);
  });
});
