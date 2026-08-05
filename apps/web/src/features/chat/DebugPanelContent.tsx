import type { ReactNode } from 'react';
import type { DebugMessage, TurnDebugSnapshot } from './useTurnDebugSnapshot.js';
import { MessageCard } from './DebugMessageCard.js';
import { MetadataCard, ToolsList } from './DebugPanelSections.js';

function StatTile({
  kind,
  label,
  value
}: {
  kind: 'fresh' | 'read' | 'write' | 'output';
  label: string;
  value: number | null;
}): ReactNode {
  return (
    <div className={`debug-panel__stat-tile debug-panel__stat-tile--${kind}`}>
      <span className="debug-panel__stat-label">
        <span className="debug-panel__swatch" />
        {label}
      </span>
      {value === null ? (
        <span className="debug-panel__stat-value debug-panel__stat-value--na" title="Not applicable — OpenAI's prefix caching is automatic and free to populate">
          n/a
        </span>
      ) : (
        <span className="debug-panel__stat-value">{value.toLocaleString()}</span>
      )}
    </div>
  );
}

export function DebugPanelContent({
  snapshot,
  sessionId,
  copied,
  onCopy,
  onClose
}: {
  snapshot: TurnDebugSnapshot;
  sessionId: string;
  copied: boolean;
  onCopy: (snapshot: TurnDebugSnapshot) => void;
  onClose: () => void;
}): ReactNode {
  // The system layers travel in the model call's own `instructions` slot, but
  // the panel exists to show the request as the provider sees it — cache
  // breakpoints and all — so they render first, ahead of the conversation.
  const requestMessages = [...snapshot.request.instructions, ...snapshot.request.messages] as DebugMessage[];
  const responseMessages = snapshot.response.messages as DebugMessage[];
  const usage = snapshot.response.usage;

  return (
    <>
      <div className="debug-panel__header">
        <div className="debug-panel__title-block">
          <h1>Coach turn — debug</h1>
          <div className="debug-panel__subtitle">
            <span>{snapshot.request.provider}</span>
            <span className="debug-panel__dot">·</span>
            <span>{snapshot.request.model}</span>
            <span className="debug-panel__dot">·</span>
            <span>reasoning {snapshot.request.reasoning}</span>
            <span className="debug-panel__dot">·</span>
            <span>
              session {sessionId.slice(0, 4)}…{sessionId.slice(-4)}
            </span>
          </div>
        </div>
        <button type="button" className="debug-panel__btn debug-panel__btn--copy" onClick={() => onCopy(snapshot)}>
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
        <button type="button" className="debug-panel__btn debug-panel__btn--icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="debug-panel__usage-strip">
        <StatTile kind="fresh" label="Fresh input" value={usage.freshInputTokens} />
        <StatTile kind="read" label="Cache read" value={usage.cacheReadTokens} />
        <StatTile kind="write" label="Cache write" value={usage.cacheWriteTokens} />
        <StatTile kind="output" label="Output" value={usage.outputTokens} />
        <StatTile kind="output" label="Reasoning" value={usage.reasoningTokens} />
      </div>

      <div className="debug-panel__body">
        <div className="debug-panel__col">
          <div className="debug-panel__col-header">
            <span className="debug-panel__arrow">→</span> Sent to model ({requestMessages.length} messages)
          </div>
          <div className="debug-panel__col-scroll">
            {requestMessages.map((message, index) => (
              <MessageCard
                key={index}
                message={message}
                defaultExpanded={index >= requestMessages.length - 3}
              />
            ))}
            <div className="debug-panel__section-label">tools ({snapshot.request.tools.length})</div>
            <ToolsList tools={snapshot.request.tools} />
          </div>
        </div>

        <div className="debug-panel__col">
          <div className="debug-panel__col-header">
            <span className="debug-panel__arrow">←</span> Received this turn
          </div>
          <div className="debug-panel__col-scroll">
            {responseMessages.map((message, index) => (
              <MessageCard key={index} message={message} defaultExpanded isNew />
            ))}
            <div className="debug-panel__section-label">turn metadata</div>
            <MetadataCard providerMetadata={snapshot.response.providerMetadata} />
          </div>
          <div className="debug-panel__finish-tag">
            finishReason: <b>{snapshot.response.finishReason}</b>
          </div>
        </div>
      </div>
    </>
  );
}
