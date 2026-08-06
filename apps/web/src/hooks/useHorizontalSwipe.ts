import { useCallback, useRef, type TouchEvent, type TouchEventHandler } from 'react';

/** Past this the gesture is committed to an axis — below it a touch is still
 * ambiguous and neither the swipe nor the scroller should claim it. */
const AXIS_LOCK_PX = 8;
/** How far a horizontal drag must travel to count as a panel switch. */
const SWIPE_THRESHOLD_PX = 56;

export interface UseHorizontalSwipeOptions {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  /** CSS selector for subtrees that own horizontal touch themselves — the
   * board (piece dragging) and the scrolling move strip. A touch starting
   * inside one never becomes a swipe. */
  reservedSelector?: string;
  /** Live horizontal distance while a swipe is in progress, 0 once it ends —
   * lets the caller drag the panels with the finger. */
  onDrag?: (dx: number) => void;
}

export type HorizontalSwipeHandlers = {
  onTouchStart: TouchEventHandler;
  onTouchMove: TouchEventHandler;
  onTouchEnd: TouchEventHandler;
  onTouchCancel: TouchEventHandler;
};

type Axis = 'undecided' | 'horizontal' | 'vertical';

interface Gesture {
  startX: number;
  startY: number;
  axis: Axis;
  dx: number;
}

function startsInReservedSubtree(event: TouchEvent, reservedSelector: string | undefined): boolean {
  if (!reservedSelector) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return target.closest(reservedSelector) !== null;
}

function axisFor(dx: number, dy: number): Axis {
  if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return 'undecided';
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}

/** Touch-only, one finger: turns a horizontal drag anywhere outside the
 * reserved subtrees into a left/right swipe. Vertical intent wins as soon as
 * the gesture locks to an axis, so chat scrolling is never stolen. */
export function useHorizontalSwipe({
  onSwipeLeft,
  onSwipeRight,
  reservedSelector,
  onDrag
}: UseHorizontalSwipeOptions): HorizontalSwipeHandlers {
  const gestureRef = useRef<Gesture | null>(null);

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    onDrag?.(0);
  }, [onDrag]);

  const onTouchStart = useCallback(
    (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1 || startsInReservedSubtree(event, reservedSelector)) {
        gestureRef.current = null;
        return;
      }
      gestureRef.current = { startX: touch.clientX, startY: touch.clientY, axis: 'undecided', dx: 0 };
    },
    [reservedSelector]
  );

  const onTouchMove = useCallback(
    (event: TouchEvent) => {
      const gesture = gestureRef.current;
      const touch = event.touches[0];
      if (!gesture || !touch) return;
      if (event.touches.length > 1) return endGesture();

      gesture.dx = touch.clientX - gesture.startX;
      if (gesture.axis === 'undecided') gesture.axis = axisFor(gesture.dx, touch.clientY - gesture.startY);
      if (gesture.axis === 'vertical') return endGesture();
      if (gesture.axis === 'horizontal') onDrag?.(gesture.dx);
    },
    [endGesture, onDrag]
  );

  const onTouchEnd = useCallback(() => {
    const gesture = gestureRef.current;
    endGesture();
    if (!gesture || gesture.axis !== 'horizontal' || Math.abs(gesture.dx) < SWIPE_THRESHOLD_PX) return;
    if (gesture.dx < 0) return onSwipeLeft();
    onSwipeRight();
  }, [endGesture, onSwipeLeft, onSwipeRight]);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: endGesture };
}
