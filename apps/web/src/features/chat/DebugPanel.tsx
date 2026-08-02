import { useEffect, useState, type ReactNode } from 'react';
import { useTurnDebugSnapshot, type TurnDebugSnapshot } from './useTurnDebugSnapshot.js';
import { DebugPanelContent } from './DebugPanelContent.js';
import './DebugPanel.css';

export interface DebugPanelProps {
  sessionId: string;
  onClose: () => void;
}

/** "Debug last answer" popup: the literal request sent to the LLM and the
 * literal response it returned for the most recent coach turn, rendered as a
 * readable console/network-inspector-style view instead of raw JSON. */
export function DebugPanel({ sessionId, onClose }: DebugPanelProps): ReactNode {
  const state = useTurnDebugSnapshot(sessionId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleCopy(snapshot: TurnDebugSnapshot): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="debug-panel-backdrop" onClick={onClose}>
      <div
        className="debug-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Coach turn debug"
        onClick={(event) => event.stopPropagation()}
      >
        {state.status === 'loading' && <div className="debug-panel__status">Loading…</div>}
        {state.status === 'error' && <div className="debug-panel__status">{state.message}</div>}
        {state.status === 'ready' && (
          <DebugPanelContent snapshot={state.snapshot} sessionId={sessionId} copied={copied} onCopy={handleCopy} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
