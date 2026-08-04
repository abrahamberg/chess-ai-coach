import { useRef } from 'react';
import type { PointerEvent } from 'react';

const LONG_PRESS_MS = 500;

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerLeave: (event: PointerEvent) => void;
}

/** No native long-press event exists — press-and-hold via a timer started on
 * pointerdown, cancelled on pointerup/pointerleave (covers touch and mouse
 * alike, unlike touch-only events). Used by MoveStrip to open the move
 * analysis inspector on mobile, where there's no right-click to hook. */
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clear(): void {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  return {
    onPointerDown: () => {
      clear();
      timeoutRef.current = setTimeout(onLongPress, LONG_PRESS_MS);
    },
    onPointerUp: clear,
    onPointerLeave: clear
  };
}
