import { useState, type FormEvent, type ReactNode } from 'react';
import type { ImportGameRequest } from '@chess-coach/shared';

export interface PgnPasteFormProps {
  onSubmit: (body: ImportGameRequest) => void;
}

/** Pure form: builds an ImportGameRequestSchema-shaped body and hands it to
 * the caller. No fetching here — ImportPage owns the mutation. */
export function PgnPasteForm({ onSubmit }: PgnPasteFormProps): ReactNode {
  const [pgn, setPgn] = useState('');

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = pgn.trim();
    if (!trimmed) return;
    onSubmit({ pgn: trimmed, source: 'paste' });
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="pgn-paste-input">PGN</label>
      <textarea
        id="pgn-paste-input"
        value={pgn}
        onChange={(event) => setPgn(event.target.value)}
        rows={10}
      />
      <button type="submit">Import game</button>
    </form>
  );
}
