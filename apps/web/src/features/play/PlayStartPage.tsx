import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import type { PlayerColor } from '@chess-coach/shared';
import { apiPost } from '../../api/client.js';
import './PlayStartPage.css';

const PlaySessionSchema = z.object({ id: z.string() });

/**
 * architecture §14: entry point for a live sparring game against the coach —
 * distinct from GamesPage's "start session from an imported game" flow,
 * since play mode has no game to pick, only a color. Mirrors ImportPage's
 * mutation-then-navigate handoff and reuses ColorConfirm's visual language
 * (docs/design.md — no new component styling introduced here).
 */
export function PlayStartPage(): ReactNode {
  const navigate = useNavigate();

  const startMutation = useMutation({
    mutationFn: (studentColor: PlayerColor) => apiPost('/api/sessions/play', { studentColor }, PlaySessionSchema),
    onSuccess: (session) => navigate(`/session/${session.id}`)
  });

  return (
    <div className="page play-start-page">
      <h1>Play the coach</h1>
      <p>Play a live game against the coach and get feedback as you go, not just after the fact.</p>
      <div className="color-confirm">
        <div className="color-confirm__options">
          <button type="button" disabled={startMutation.isPending} onClick={() => startMutation.mutate('white')}>
            Play as White
          </button>
          <button type="button" disabled={startMutation.isPending} onClick={() => startMutation.mutate('black')}>
            Play as Black
          </button>
        </div>
      </div>
      {startMutation.isError && (
        <p role="alert" className="play-start-page__error">
          Could not start a game. Please try again.
        </p>
      )}
    </div>
  );
}
