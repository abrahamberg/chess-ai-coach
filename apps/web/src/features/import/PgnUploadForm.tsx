import { useState, type ChangeEvent, type ReactNode } from 'react';
import type { ImportGameRequest } from '@chess-coach/shared';

export interface PgnUploadFormProps {
  onSubmit: (body: Pick<ImportGameRequest, 'pgn' | 'source'>) => void;
}

/** specs.md F1.1 / design.md §4.2: "Upload" segment of the import control —
 * reads a .pgn file's text and hands it to the caller. No fetching here
 * (ImportPage owns the mutation), matching PgnPasteForm's pattern. */
export function PgnUploadForm({ onSubmit }: PgnUploadFormProps): ReactNode {
  const [error, setError] = useState<string | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const pgn = typeof reader.result === 'string' ? reader.result.trim() : '';
      if (!pgn) {
        setError('That file was empty.');
        return;
      }
      onSubmit({ pgn, source: 'upload' });
    };
    reader.onerror = () => setError('Could not read that file. Try again.');
    reader.readAsText(file);
  }

  return (
    <div className="pgn-upload-form">
      <label htmlFor="pgn-upload-input">PGN file</label>
      <input id="pgn-upload-input" type="file" accept=".pgn" onChange={handleChange} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
