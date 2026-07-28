import type { FocusAreaSummary } from '@chess-coach/shared';
import type { ReactNode } from 'react';
import { CATEGORY_LABELS } from './categoryLabels.js';

export interface FocusAreaCardProps {
  area: FocusAreaSummary;
}

const TREND_ARROW: Record<FocusAreaSummary['status'], string> = {
  improving: '↗',
  active: '→',
  resolved: '✓'
};

/** design.md §4.3: focus-area card — category in plain words, coach note,
 * trend arrow, evidence count. No color-coded judgment beyond the arrow. */
export function FocusAreaCard({ area }: FocusAreaCardProps): ReactNode {
  return (
    <div className="focus-area-card">
      <span className="focus-area-card__trend" aria-hidden="true">
        {TREND_ARROW[area.status]}
      </span>
      <h3>{CATEGORY_LABELS[area.category]}</h3>
      <p>{area.note}</p>
      <p className="focus-area-card__meta">{area.evidenceCount} pieces of evidence</p>
    </div>
  );
}
