import type { ReactNode } from 'react';

export interface MoveCardProps {
  san: string;
  fen: string;
}

/** design.md §5.3: the student's board move rendered as a compact chat card. */
export function MoveCard({ san }: MoveCardProps): ReactNode {
  return (
    <p className="move-card">
      You played <code className="san">{san}</code>
    </p>
  );
}
