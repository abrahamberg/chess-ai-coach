import { useState, type ReactNode } from 'react';
import type { TurnDebugSnapshot } from './useTurnDebugSnapshot.js';

export function ToolsList({ tools }: { tools: TurnDebugSnapshot['request']['tools'] }): ReactNode {
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

export function MetadataCard({ providerMetadata }: { providerMetadata: unknown }): ReactNode {
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
