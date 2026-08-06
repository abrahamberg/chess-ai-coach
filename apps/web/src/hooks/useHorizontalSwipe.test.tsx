import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { useHorizontalSwipe, type UseHorizontalSwipeOptions } from './useHorizontalSwipe.js';

function Harness(options: UseHorizontalSwipeOptions): ReactNode {
  const handlers = useHorizontalSwipe(options);
  return (
    <div data-testid="area" {...handlers}>
      <div className="coach-board-frame" data-testid="reserved" />
      <div data-testid="plain" />
    </div>
  );
}

function touch(clientX: number, clientY: number) {
  return { touches: [{ clientX, clientY }] };
}

function swipe(from: { x: number; y: number }, to: { x: number; y: number }, testId = 'plain'): void {
  const target = screen.getByTestId(testId);
  fireEvent.touchStart(target, touch(from.x, from.y));
  fireEvent.touchMove(target, touch(to.x, to.y));
  fireEvent.touchEnd(target, { touches: [] });
}

function renderHarness(overrides: Partial<UseHorizontalSwipeOptions> = {}) {
  const onSwipeLeft = vi.fn();
  const onSwipeRight = vi.fn();
  render(
    <Harness
      onSwipeLeft={onSwipeLeft}
      onSwipeRight={onSwipeRight}
      reservedSelector=".coach-board-frame"
      {...overrides}
    />
  );
  return { onSwipeLeft, onSwipeRight };
}

describe('useHorizontalSwipe', () => {
  test('a long leftward drag swipes left', () => {
    const { onSwipeLeft, onSwipeRight } = renderHarness();

    swipe({ x: 300, y: 400 }, { x: 120, y: 410 });

    expect(onSwipeLeft).toHaveBeenCalledOnce();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  test('a long rightward drag swipes right', () => {
    const { onSwipeLeft, onSwipeRight } = renderHarness();

    swipe({ x: 120, y: 400 }, { x: 300, y: 400 });

    expect(onSwipeRight).toHaveBeenCalledOnce();
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  test('a drag shorter than the threshold snaps back instead of switching', () => {
    const { onSwipeLeft, onSwipeRight } = renderHarness();

    swipe({ x: 300, y: 400 }, { x: 270, y: 400 });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  test('a mostly-vertical drag is left to the scroller', () => {
    const { onSwipeLeft, onSwipeRight } = renderHarness();

    swipe({ x: 300, y: 400 }, { x: 240, y: 200 });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  test('a drag starting inside a reserved subtree (the board) never swipes', () => {
    const { onSwipeLeft, onSwipeRight } = renderHarness();

    swipe({ x: 300, y: 400 }, { x: 100, y: 400 }, 'reserved');

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  test('reports the live drag distance, then 0 once the finger lifts', () => {
    const onDrag = vi.fn();
    renderHarness({ onDrag });

    swipe({ x: 300, y: 400 }, { x: 200, y: 400 });

    expect(onDrag).toHaveBeenCalledWith(-100);
    expect(onDrag).toHaveBeenLastCalledWith(0);
  });
});
