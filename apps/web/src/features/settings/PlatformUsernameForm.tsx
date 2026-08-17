import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

export interface PlatformUsernameFormProps {
  platform: 'lichess' | 'chesscom';
  label: string;
  value: string | null;
  onSave: (username: string) => void;
  onDelete: () => void;
}

/** design.md §4.4 Profile: lichess/chess.com usernames — add/edit/delete here.
 * Once set (by hand, or auto-learned the first time a PGN from that site is
 * scanned — see game-import.ts's learnPlatformUsername, which only fires when
 * the side had to be picked manually because this field was unset), future
 * imports match the PGN's White/Black tag against it and skip the "which side
 * were you" prompt. */
export function PlatformUsernameForm({ platform, label, value, onSave, onDelete }: PlatformUsernameFormProps): ReactNode {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  // Resyncs draft when value changes out from under an idle (non-editing) form —
  // e.g. Delete clearing it to null, or a background refetch — so the "add" form
  // that appears afterward doesn't show stale leftover text. Skipped while
  // isEditing so it never clobbers what the student is mid-typing.
  useEffect(() => {
    if (!isEditing) setDraft(value ?? '');
  }, [value, isEditing]);

  function startEditing(): void {
    setDraft(value ?? '');
    setIsEditing(true);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setIsEditing(false);
  }

  if (value && !isEditing) {
    return (
      <p className="platform-username-form">
        <span>
          {label}: {value}
        </span>{' '}
        <button type="button" onClick={startEditing}>
          Edit
        </button>{' '}
        <button type="button" onClick={onDelete}>
          Delete
        </button>
      </p>
    );
  }

  return (
    <form className="platform-username-form" onSubmit={handleSubmit}>
      <label htmlFor={`platform-username-${platform}`}>{label}</label>
      <input
        id={`platform-username-${platform}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Not set"
      />
      <button type="submit" className="btn-primary">
        Save
      </button>
      {value && (
        <button type="button" onClick={() => setIsEditing(false)}>
          Cancel
        </button>
      )}
    </form>
  );
}
