import { useMemo, useState, type ReactNode } from 'react';
import { toolCallInput, toolResultValue } from './toolParts.js';
import type { DebugMessage } from './useTurnDebugSnapshot.js';

function roleOf(message: DebugMessage): string {
  return typeof message.role === 'string' ? message.role : 'unknown';
}

function isCached(message: DebugMessage): boolean {
  const providerOptions = message.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined;
  return Boolean(providerOptions?.anthropic?.cacheControl);
}

export function MessageCard({
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
        <pre>{JSON.stringify(toolCallInput(record), null, 2)}</pre>
      </div>
    );
  }
  if (record.type === 'tool-result') {
    return (
      <div className="debug-panel__tool-block">
        <span className="debug-panel__tool-name">{String(record.toolName ?? '')} result</span>
        <pre>{JSON.stringify(toolResultValue(record), null, 2)}</pre>
      </div>
    );
  }
  return <pre>{JSON.stringify(record, null, 2)}</pre>;
}
