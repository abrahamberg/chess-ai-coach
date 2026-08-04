import type { ReactNode } from 'react';
import './JsonTreeView.css';

export interface JsonTreeViewProps {
  data: unknown;
  /** Nesting depth (0 = top level) that stays expanded by default; deeper
   * nodes render collapsed but are still expandable. */
  defaultOpenDepth?: number;
}

/** Hand-rolled collapsible, color-coded JSON tree — no such viewer exists
 * anywhere in this app yet, and none of its dependencies suggest reaching
 * for a library for something this small. */
export function JsonTreeView({ data, defaultOpenDepth = 1 }: JsonTreeViewProps): ReactNode {
  return <div className="json-tree">{renderValue(data, 0, defaultOpenDepth)}</div>;
}

function renderValue(value: unknown, depth: number, defaultOpenDepth: number): ReactNode {
  if (value === null || value === undefined) {
    return <span className="json-null">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="json-boolean">{String(value)}</span>;
  }
  if (typeof value === 'number') {
    const sign = value < 0 ? 'json-number--negative' : value > 0 ? 'json-number--positive' : '';
    return <span className={['json-number', sign].filter(Boolean).join(' ')}>{value}</span>;
  }
  if (typeof value === 'string') {
    return <span className="json-string">&quot;{value}&quot;</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="json-punct">[ ]</span>;
    return (
      <details open={depth < defaultOpenDepth}>
        <summary>Array({value.length})</summary>
        <div className="json-tree__children">
          {value.map((item, index) => (
            <div className="json-tree__entry" key={index}>
              <span className="json-key">{index}</span>
              <span className="json-punct">: </span>
              {renderValue(item, depth + 1, defaultOpenDepth)}
            </div>
          ))}
        </div>
      </details>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="json-punct">{'{ }'}</span>;
  return (
    <details open={depth < defaultOpenDepth}>
      <summary>Object({entries.length})</summary>
      <div className="json-tree__children">
        {entries.map(([key, item]) => (
          <div className="json-tree__entry" key={key}>
            <span className="json-key">{key}</span>
            <span className="json-punct">: </span>
            {renderValue(item, depth + 1, defaultOpenDepth)}
          </div>
        ))}
      </div>
    </details>
  );
}
