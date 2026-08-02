import { useCallback, useEffect, useRef, useState } from 'react';

export const DEFAULT_AUTOPLAY_INTERVAL_MS = 1000;

export interface UseLineAutoplayResult {
  isPlaying: boolean;
  toggle: () => void;
}

/**
 * Steps a controlled `currentStep` forward one at a time while playing,
 * pausing once it reaches `stepCount`. `currentStep` is owned by the
 * caller (DivergedLinePanel's stepIndex) — this hook only ever proposes the
 * next step via `onStep`, mirroring how react-chessboard's controlled
 * position works (CoachBoard.tsx).
 */
export function useLineAutoplay(
  stepCount: number,
  currentStep: number,
  intervalMs: number,
  onStep: (next: number) => void
): UseLineAutoplayResult {
  const [isPlaying, setIsPlaying] = useState(false);
  // Set by toggle() when it resets an already-finished line back to step 0;
  // guards the effect below against pausing itself on the same tick, before
  // the caller's currentStep prop has caught up to the reset.
  const awaitingRestartRef = useRef(false);

  useEffect(() => {
    if (!isPlaying) return;
    if (currentStep >= stepCount) {
      if (awaitingRestartRef.current) return;
      setIsPlaying(false);
      return;
    }
    awaitingRestartRef.current = false;
    const timer = setTimeout(() => onStep(currentStep + 1), intervalMs);
    return () => clearTimeout(timer);
  }, [isPlaying, currentStep, stepCount, intervalMs, onStep]);

  const toggle = useCallback(() => {
    // Every line starts fully played out (appendMove/hypothetical_line
    // both jump stepIndex to the end immediately) — without this, starting
    // playback from there sees currentStep >= stepCount on the first tick and
    // stops before ever moving, so autoplay looks like it does nothing.
    if (!isPlaying && currentStep >= stepCount) {
      awaitingRestartRef.current = true;
      onStep(0);
    }
    setIsPlaying((prev) => !prev);
  }, [isPlaying, currentStep, stepCount, onStep]);

  return { isPlaying, toggle };
}
