import type { MoveQuality } from '@chess-coach/shared';
import { useState } from 'react';
import { apiPost, ApiError } from '../../api/client.js';
import { CommitPlayMoveResponseSchema } from './sessionPageSchemas.js';

export interface CommittedPlayMove {
  fen: string;
  san: string;
  ply: number;
  quality: MoveQuality;
}

export interface UsePlayMoveSubmitResult {
  /** Belt-and-suspenders 422 message (see submit's doc comment), or null
   * once a submission succeeds/hasn't been tried yet. */
  error: string | null;
  submit: (san: string, uci: string) => Promise<void>;
}

/** Client-side chess.js validation in CoachBoard already rejects most
 * illegal drops before onUserMove ever fires — a 422 here is belt-and-
 * suspenders for whatever that can't catch (e.g. a stale position after a
 * server-side undo), not the everyday path. */
function describePlayMoveError(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object' && 'title' in error.body) {
    const title = (error.body as { title?: unknown }).title;
    if (typeof title === 'string' && title.length > 0) return title;
  }
  return 'That move was rejected.';
}

/**
 * architecture §14: commits the student's play-mode move synchronously via
 * POST /api/sessions/:id/play-move (not the SSE chat endpoint) before the
 * coach's feedback-first turn starts — SessionBoardColumn's handleUserMove
 * calls submit() instead of sending an instant [board_move] chat message.
 */
export function usePlayMoveSubmit(
  sessionId: string,
  sendMessage: (content: string) => void,
  onPlayMoveCommitted?: (result: CommittedPlayMove, uci: string) => void
): UsePlayMoveSubmitResult {
  const [error, setError] = useState<string | null>(null);

  async function submit(san: string, uci: string): Promise<void> {
    setError(null);
    try {
      const result = await apiPost(`/api/sessions/${sessionId}/play-move`, { san }, CommitPlayMoveResponseSchema);
      onPlayMoveCommitted?.(result, uci);
      sendMessage(`[player_move] I played ${san}.`);
    } catch (submitError) {
      setError(describePlayMoveError(submitError));
    }
  }

  return { error, submit };
}
