import type { ReactNode } from 'react';
import type { PlayerColor } from '@chess-coach/shared';

export interface ColorConfirmProps {
  onConfirm: (color: PlayerColor) => void;
}

/** Shown when the API can't detect the student's side from the PGN headers
 * (422 {missing: 'userColor'}) — the student picks, and the import retries. */
export function ColorConfirm({ onConfirm }: ColorConfirmProps): ReactNode {
  return (
    <div>
      <p>We couldn&rsquo;t tell which side you played. Which color were you?</p>
      <button type="button" onClick={() => onConfirm('white')}>
        White
      </button>
      <button type="button" onClick={() => onConfirm('black')}>
        Black
      </button>
    </div>
  );
}
