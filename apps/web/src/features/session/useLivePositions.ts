import type { ParsedPosition } from '@chess-coach/chess-analysis';
import { useEffect, useRef, useState } from 'react';

export interface UseLivePositionsResult {
  positions: ParsedPosition[];
  append: (position: ParsedPosition) => void;
  truncateTo: (ply: number) => void;
}

/**
 * architecture §14: play mode's board positions grow move-by-move (the
 * student's own POST /play-move, the coach's play_coach_move tool) or shrink
 * by one (undo_last_move) — unlike analyze mode's, which come once from
 * parsePgn and never change. `seed` arrives after mount (the game fetch
 * resolves on a later render), so it's applied via effect once, mirroring
 * useSessionBoardState's initialPly seeding for the same reason; after that,
 * append/truncateTo own the array.
 */
export function useLivePositions(seed: ParsedPosition[] | undefined): UseLivePositionsResult {
  const [positions, setPositions] = useState<ParsedPosition[]>([]);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!seededRef.current && seed !== undefined) {
      seededRef.current = true;
      setPositions(seed);
    }
  }, [seed]);

  function append(position: ParsedPosition): void {
    setPositions((prev) => [...prev, position]);
  }

  function truncateTo(ply: number): void {
    setPositions((prev) => prev.filter((position) => position.ply <= ply));
  }

  return { positions, append, truncateTo };
}
