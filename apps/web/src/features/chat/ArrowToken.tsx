import type { ReactNode } from 'react';

export interface ArrowTokenProps {
  from: string;
  to: string;
}

/** Read-only rendering of an inline `[from-to]` arrow reference inside a
 * sent message — the transcript twin of the composer's editable ArrowChip. */
export function ArrowToken({ from, to }: ArrowTokenProps): ReactNode {
  return (
    <span className="arrow-token">
      <code className="san">{from}</code>
      {'→'}
      <code className="san">{to}</code>
    </span>
  );
}
