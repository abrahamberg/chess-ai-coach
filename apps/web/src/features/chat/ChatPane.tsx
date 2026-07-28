import { useState, type FormEvent, type ReactNode } from 'react';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { MessageList } from './MessageList.js';
import { ThinkingIndicator } from './ThinkingIndicator.js';
import { ToolActivity } from './ToolActivity.js';
import './ChatPane.css';

export interface ChatPaneProps {
  messages: CoachMessage[];
  activeToolName: string | null;
  /** design.md §5.7: shows the delayed 3-dot typing indicator. */
  isThinking?: boolean;
  onSend: (content: string) => void;
  onScrollUp?: () => void;
}

/** Composes MessageList + ToolActivity + the reply input. No fetching — the
 * parent (SessionPage) owns useCoachChat. */
export function ChatPane({ messages, activeToolName, isThinking = false, onSend, onScrollUp }: ChatPaneProps): ReactNode {
  const [draft, setDraft] = useState('');

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
  }

  return (
    <div className="chat-pane">
      <MessageList messages={messages} onScrollUp={onScrollUp} />
      <ThinkingIndicator visible={isThinking} />
      <ToolActivity toolName={activeToolName} />
      <form onSubmit={handleSubmit}>
        <label htmlFor="chat-reply-input">Reply</label>
        <input
          id="chat-reply-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="type a reply…"
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
