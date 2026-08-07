import type { GameListItem } from '@chess-coach/shared';
import type { ReactNode } from 'react';
import './GameRow.css';

export interface GameRowProps {
  game: GameListItem;
  onSelect: (gameId: string) => void;
}

const RESULT_DOT: Record<string, { symbol: string; label: string }> = {
  '1-0': { symbol: 'W', label: 'win' },
  '0-1': { symbol: 'L', label: 'loss' },
  '1/2-1/2': { symbol: 'D', label: 'draw' }
};

/** architecture §14: a coach_play game never gets an `analyses` row, so its
 * analysisStatus is always null — it needs its own chip logic rather than
 * falling into analyze mode's "analyzing…" default. */
function chipFor(game: GameListItem): { text: string; className: string } {
  if (game.source === 'coach_play') {
    if (game.sessionId) return { text: 'in progress — continue', className: 'game-row__chip--ready' };
    return { text: 'game over', className: 'game-row__chip--analyzing' };
  }
  if (game.analysisStatus === 'ready') return { text: 'ready — start session', className: 'game-row__chip--ready' };
  if (game.analysisStatus === 'failed') return { text: 'failed — retry', className: 'game-row__chip--failed' };
  return { text: 'analyzing…', className: 'game-row__chip--analyzing' };
}

function userSideResult(game: GameListItem): { symbol: string; label: string } | null {
  if (!game.result) return null;
  const dot = RESULT_DOT[game.result];
  if (!dot) return null;
  const userWasWhite = game.userColor === 'white';
  if (game.result === '1/2-1/2') return dot;
  const userWon = (userWasWhite && game.result === '1-0') || (!userWasWhite && game.result === '0-1');
  return userWon ? { symbol: 'W', label: 'win' } : { symbol: 'L', label: 'loss' };
}

/** design.md §4.1: a Games (home) list row — players + result (user's side
 * bold, W/L/D dot), date, time control, and an analysis status chip. The
 * whole row is tappable. */
export function GameRow({ game, onSelect }: GameRowProps): ReactNode {
  const chip = chipFor(game);
  const dot = userSideResult(game);
  const date = game.playedAt ?? game.createdAt;
  const [whiteName, blackName] = [game.whiteName ?? '?', game.blackName ?? '?'];
  const userIsWhite = game.userColor === 'white';

  return (
    <li className="game-row">
      <button type="button" onClick={() => onSelect(game.id)}>
        {dot && (
          <span className={`game-row__dot game-row__dot--${dot.label}`} title={dot.label}>
            {dot.symbol}
          </span>
        )}
        <span className="game-row__players">
          <span className={userIsWhite ? 'game-row__you' : undefined}>{whiteName}</span>
          {' vs. '}
          <span className={!userIsWhite ? 'game-row__you' : undefined}>{blackName}</span>
        </span>
        <span className="game-row__meta">
          <time dateTime={date}>{new Date(date).toLocaleDateString()}</time>
          {game.timeControl && <span> · {game.timeControl}</span>}
        </span>
        <span className={`game-row__chip ${chip.className}`}>{chip.text}</span>
      </button>
    </li>
  );
}
