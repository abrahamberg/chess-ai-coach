import { GameListResponseSchema } from '@chess-coach/shared';
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
 * presentational. A ready row starts a session (mirrors ImportPage's
 * post-analysis handoff) rather than looking one up, since no per-game
 * session lookup endpoint exists yet. */
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

  function handleSelect(gameId: string, analysisStatus: string | null): void {
    if (analysisStatus !== 'ready') return;
    sessionMutation.mutate(gameId);
  }

  return (
    <div className="page games-page">
      <h1>Games</h1>
      <Link to="/import" className="games-page__cta">
        Analyze a game
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
            <GameRow key={game.id} game={game} onSelect={(id) => handleSelect(id, game.analysisStatus)} />
          ))}
        </ul>
      )}
    </div>
  );
}
