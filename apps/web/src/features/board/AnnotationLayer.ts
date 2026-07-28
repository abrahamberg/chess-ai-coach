import { useCallback, useState } from 'react';
import type { BoardArrow, BoardHighlight } from './CoachBoard.js';

export interface AnnotationState {
  arrows: BoardArrow[];
  highlights: BoardHighlight[];
}

const EMPTY: AnnotationState = { arrows: [], highlights: [] };

export interface UseAnnotationLayerResult extends AnnotationState {
  setAnnotations: (next: AnnotationState) => void;
  clear: () => void;
}

/** design.md §5.4: the coach's arrows/highlights (annotate_board) are cleared
 * on the next show_position — the caller wires clear() to that tool call. */
export function useAnnotationLayer(): UseAnnotationLayerResult {
  const [state, setState] = useState<AnnotationState>(EMPTY);

  const setAnnotations = useCallback((next: AnnotationState) => setState(next), []);
  const clear = useCallback(() => setState(EMPTY), []);

  return { ...state, setAnnotations, clear };
}
