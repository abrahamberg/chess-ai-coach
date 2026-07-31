import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { apiGet, ApiError } from '../../api/client.js';
import './DebugPanel.css';

/** Deliberately loose: the snapshot is the literal object that hit the LLM
 * and the literal object it returned (coach debug mode design doc, "No
 * reshaping of the captured data") — this validates the envelope, not the
 * internal message/part shapes, which vary by provider and step. */
const TurnUsageSchema = z.object({
  freshInputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number().nullable(),
  outputTokens: z.number()
});

const TurnDebugSnapshotSchema = z.object({
  request: z.object({
    provider: z.string(),
    model: z.string(),
    messages: z.array(z.unknown()),
    tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.unknown() })),
    maxSteps: z.number()
  }),
  response: z.object({
    messages: z.array(z.unknown()),
    finishReason: z.string(),
    usage: TurnUsageSchema,
    providerMetadata: z.unknown()
  })
});

type TurnDebugSnapshot = z.infer<typeof TurnDebugSnapshotSchema>;
type DebugMessage = { role?: unknown; content?: unknown; providerOptions?: unknown; id?: unknown };

export interface DebugPanelProps {
  sessionId: string;
  onClose: () => void;
}

/** "Debug last answer" popup: the literal request sent to the LLM and the
 * literal response it returned for the most recent coach turn, rendered as a
 * readable console/network-inspector-style view instead of raw JSON. */
export function DebugPanel({ sessionId, onClose }: DebugPanelProps): ReactNode {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; snapshot: TurnDebugSnapshot }
  >({ status: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    apiGet(`/api/sessions/${sessionId}/debug/last-turn`, TurnDebugSnapshotSchema)
      .then((snapshot) => {
        if (!cancelled) setState({ status: 'ready', snapshot });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof ApiError && error.status === 404
            ? 'No completed turn to debug yet.'
            : 'Could not load debug data.';
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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

function DebugPanelContent({
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
  const requestMessages = snapshot.request.messages as DebugMessage[];
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

function roleOf(message: DebugMessage): string {
  return typeof message.role === 'string' ? message.role : 'unknown';
}

function isCached(message: DebugMessage): boolean {
  const providerOptions = message.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined;
  return Boolean(providerOptions?.anthropic?.cacheControl);
}

function MessageCard({
  message,
  defaultExpanded = false,
  isNew = false
}: {
  message: DebugMessage;
  defaultExpanded?: boolean;
  isNew?: boolean;
}): ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const role = roleOf(message);
  const preview = useMemo(() => previewFor(message), [message]);

  return (
    <div className={`debug-panel__msg${expanded ? '' : ' debug-panel__msg--collapsed'}`} data-role={role}>
      <button type="button" className="debug-panel__msg-row" onClick={() => setExpanded((current) => !current)}>
        <span className="debug-panel__role-pill">{role}</span>
        <span className="debug-panel__msg-preview">{preview}</span>
        {isNew && <span className="debug-panel__new-badge">new</span>}
        {isCached(message) && <span className="debug-panel__cache-badge">cached</span>}
        <span className="debug-panel__chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="debug-panel__msg-body">
          <MessageBody content={message.content} />
        </div>
      )}
    </div>
  );
}

function previewFor(message: DebugMessage): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(partPreview).join(' · ');
  return JSON.stringify(content);
}

function partPreview(part: unknown): string {
  if (typeof part !== 'object' || part === null) return String(part);
  const record = part as Record<string, unknown>;
  switch (record.type) {
    case 'text':
      return String(record.text ?? '');
    case 'reasoning':
      return 'reasoning';
    case 'redacted-reasoning':
      return 'redacted reasoning';
    case 'tool-call':
      return `tool call · ${String(record.toolName ?? '')}`;
    case 'tool-result':
      return `${String(record.toolName ?? '')} → result`;
    default:
      return String(record.type ?? 'part');
  }
}

function MessageBody({ content }: { content: unknown }): ReactNode {
  if (typeof content === 'string') {
    return <p>{content}</p>;
  }
  if (Array.isArray(content)) {
    return (
      <>
        {content.map((part, index) => (
          <ContentPart key={index} part={part} />
        ))}
      </>
    );
  }
  return <pre>{JSON.stringify(content, null, 2)}</pre>;
}

function ContentPart({ part }: { part: unknown }): ReactNode {
  if (typeof part !== 'object' || part === null) return <pre>{JSON.stringify(part)}</pre>;
  const record = part as Record<string, unknown>;

  if (record.type === 'text') {
    return <p>{String(record.text ?? '')}</p>;
  }
  if (record.type === 'reasoning' || record.type === 'redacted-reasoning') {
    return (
      <div className="debug-panel__reasoning-block">
        <span className="debug-panel__tag">reasoning</span>
        {record.type === 'reasoning' ? String(record.text ?? '') : '(redacted)'}
      </div>
    );
  }
  if (record.type === 'tool-call') {
    return (
      <div className="debug-panel__tool-block">
        <span className="debug-panel__tool-name">{String(record.toolName ?? '')}</span>
        <pre>{JSON.stringify(record.args, null, 2)}</pre>
      </div>
    );
  }
  if (record.type === 'tool-result') {
    return (
      <div className="debug-panel__tool-block">
        <span className="debug-panel__tool-name">{String(record.toolName ?? '')} result</span>
        <pre>{JSON.stringify(record.result, null, 2)}</pre>
      </div>
    );
  }
  return <pre>{JSON.stringify(record, null, 2)}</pre>;
}

function ToolsList({ tools }: { tools: TurnDebugSnapshot['request']['tools'] }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`debug-panel__msg${expanded ? '' : ' debug-panel__msg--collapsed'}`} data-role="tool">
      <button type="button" className="debug-panel__msg-row" onClick={() => setExpanded((current) => !current)}>
        <span className="debug-panel__role-pill">tools</span>
        <span className="debug-panel__msg-preview">{tools.map((tool) => tool.name).join(', ')}</span>
        <span className="debug-panel__chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="debug-panel__msg-body">
          {tools.map((tool) => (
            <div key={tool.name} className="debug-panel__tool-block">
              <span className="debug-panel__tool-name">{tool.name}</span>
              <p>{tool.description}</p>
              <pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetadataCard({ providerMetadata }: { providerMetadata: unknown }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`debug-panel__msg${expanded ? '' : ' debug-panel__msg--collapsed'}`} data-role="tool">
      <button type="button" className="debug-panel__msg-row" onClick={() => setExpanded((current) => !current)}>
        <span className="debug-panel__role-pill">meta</span>
        <span className="debug-panel__msg-preview">providerMetadata — raw usage block</span>
        <span className="debug-panel__chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="debug-panel__msg-body">
          <pre>{JSON.stringify(providerMetadata, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
