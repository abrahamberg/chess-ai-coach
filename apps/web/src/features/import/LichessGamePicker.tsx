import type { LichessRecentGame } from '@chess-coach/shared';
import type { ReactNode } from 'react';

export interface LichessGamePickerProps {
  games: LichessRecentGame[];
  isLoading: boolean;
  isLinked: boolean;
  onSelect: (pgn: string) => void;
}

/** design.md §4.2: "From Lichess" picker — same row format as the games list,
 * tap to select. No fetching here (AGENTS.md rule 7) — ImportPage owns it. */
export function LichessGamePicker({ games, isLoading, isLinked, onSelect }: LichessGamePickerProps): ReactNode {
  if (!isLinked) {
    return <p>Link your Lichess account in Settings to import from Lichess.</p>;
  }
  if (isLoading) {
    return <p>Loading your recent games…</p>;
  }
  if (games.length === 0) {
    return <p>No recent games found.</p>;
  }

  return (
    <ul className="lichess-game-picker">
      {games.map((game) => (
        <li key={game.id}>
          <button type="button" onClick={() => onSelect(game.pgn)}>
            <span>
              {game.whiteName ?? '?'} vs. {game.blackName ?? '?'}
            </span>
            <span>{game.result ?? '*'}</span>
            {game.playedAt && <time dateTime={game.playedAt}>{new Date(game.playedAt).toLocaleDateString()}</time>}
          </button>
        </li>
      ))}
    </ul>
  );
}
