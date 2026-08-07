import { GameListResponseSchema, type GameListItem } from '@chess-coach/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { apiGet, apiPost } from '../../api/client.js';
import { GameRow } from './GameRow.js';
import './GamesPage.css';

const SessionSummarySchema = z.object({ id: z.string() });

/** design.md §4.1: Games (home) — "Analyze a game" CTA, the game list, and
 * a no-dummy-data empty state. Owns fetching (AGENTS.md rule 7); GameRow is
 * presentational. A ready analyze-mode row hits POST /api/sessions (mirrors
 * ImportPage's post-analysis handoff) — the endpoint itself is find-or-create
 * (coachAgent.resumeOrCreateSession), so an existing active/paused session
 * for the game is linked back into rather than shadowed by a new one. A
 * coach_play row (architecture §14) instead navigates straight to its
 * already-existing sessionId — see handleSelect. */
export function GamesPage(): ReactNode {
  const navigate = useNavigate();

  const gamesQuery = useQuery({
    queryKey: ['games'],
    queryFn: ({ signal }) => apiGet('/api/games', GameListResponseSchema, signal)
  });

  const sessionMutation = useMutation({
    mutationFn: (gameId: string) => apiPost('/api/sessions', { gameId }, SessionSummarySchema),
    onSuccess: (session) => navigate(`/session/${session.id}`)
  });

  // architecture §14: a coach_play game already has its session (created by
  // POST /api/sessions/play) — link straight back into it rather than
  // routing through analyze mode's POST /api/sessions, which gates on an
  // `analyses` row a play-mode game never has.
  function handleSelect(game: GameListItem): void {
    if (game.source === 'coach_play') {
      if (game.sessionId) void navigate(`/session/${game.sessionId}`);
      return;
    }
    if (game.analysisStatus !== 'ready') return;
    sessionMutation.mutate(game.id);
  }

  return (
    <div className="page games-page">
      <h1>Games</h1>
      <Link to="/import" className="games-page__cta">
        Analyze a game
      </Link>
      <Link to="/play/new" className="games-page__cta games-page__cta--secondary">
        Play the coach
      </Link>

      {gamesQuery.isLoading && <p>Loading…</p>}
      {gamesQuery.isError && <p>Could not load your games.</p>}

      {gamesQuery.data && gamesQuery.data.length === 0 && (
        <p className="games-page__empty">
          No games yet — analyze your first game to start a coaching session, or connect your Lichess account in
          Settings.
        </p>
      )}

      {gamesQuery.data && gamesQuery.data.length > 0 && (
        <ul className="games-page__list">
          {gamesQuery.data.map((game) => (
            <GameRow key={game.id} game={game} onSelect={() => handleSelect(game)} />
          ))}
        </ul>
      )}
    </div>
  );
}
