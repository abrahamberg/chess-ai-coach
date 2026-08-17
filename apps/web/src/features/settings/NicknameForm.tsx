import { useState, type FormEvent, type ReactNode } from 'react';

export interface NicknameFormProps {
  value: string;
  onSave: (displayName: string) => void;
}

/** design.md §4.4 Profile: the display name shown everywhere in the app
 * (games list, coach chat) — editable here since the Google-login default
 * (see lib/display-name.ts) isn't always what someone wants to go by. */
export function NicknameForm({ value, onSave }: NicknameFormProps): ReactNode {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function startEditing(): void {
    setDraft(value);
    setIsEditing(true);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setIsEditing(false);
  }

  if (!isEditing) {
    return (
      <p className="nickname-form">
        {value}{' '}
        <button type="button" onClick={startEditing}>
          Edit
        </button>
      </p>
    );
  }

  return (
    <form className="nickname-form" onSubmit={handleSubmit}>
      <label htmlFor="nickname-input">Nickname</label>
      <input id="nickname-input" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit" className="btn-primary">
        Save
      </button>
      <button type="button" onClick={() => setIsEditing(false)}>
        Cancel
      </button>
    </form>
  );
}
