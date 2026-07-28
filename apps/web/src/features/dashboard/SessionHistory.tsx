import type { SessionHistoryEntry } from '@chess-coach/shared';
import type { ReactNode } from 'react';

export interface SessionHistoryProps {
  sessions: SessionHistoryEntry[];
  onSelect: (sessionId: string) => void;
}

/** design.md §4.3: session history — game, date, one-line summary, homework
 * chip if assigned. Tap reopens the session read-only. */
export function SessionHistory({ sessions, onSelect }: SessionHistoryProps): ReactNode {
  if (sessions.length === 0) {
    return <p>No sessions yet.</p>;
  }

  return (
    <ul className="session-history">
      {sessions.map((session) => (
        <li key={session.sessionId}>
          <button type="button" onClick={() => onSelect(session.sessionId)}>
            <span className="session-history__players">
              {session.whiteName ?? '?'} vs. {session.blackName ?? '?'}
            </span>
            <time dateTime={session.startedAt}>{new Date(session.startedAt).toLocaleDateString()}</time>
            <p>{session.summary}</p>
            {session.homework && (
              <p className="session-history__homework">
                <span aria-hidden="true">☐</span> {session.homework}
              </p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
