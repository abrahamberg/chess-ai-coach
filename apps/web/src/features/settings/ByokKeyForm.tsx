import type { LlmProvider } from '@chess-coach/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

export interface ByokKeyFormProps {
  provider: LlmProvider;
  isSaved: boolean;
  onSave: (apiKey: string) => void;
  onDelete: () => void;
}

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI'
};

/** design.md §4.4: "saved ✓ · delete" or "add key" — the key is never
 * redisplayed once saved, so this never renders an input for a saved key. */
export function ByokKeyForm({ provider, isSaved, onSave, onDelete }: ByokKeyFormProps): ReactNode {
  const [draft, setDraft] = useState('');

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!draft.trim()) return;
    onSave(draft.trim());
    setDraft('');
  }

  return (
    <div className="byok-key-form">
      <h3>{PROVIDER_LABELS[provider]}</h3>
      {isSaved ? (
        <p>
          saved ✓{' '}
          <button type="button" onClick={onDelete}>
            delete
          </button>
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <label htmlFor={`byok-${provider}`}>API key</label>
          <input id={`byok-${provider}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="btn-primary">
            Add key
          </button>
        </form>
      )}
    </div>
  );
}
