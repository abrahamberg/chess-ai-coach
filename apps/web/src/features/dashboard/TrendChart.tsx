import type { MistakeCategory, MistakeTrend } from '@chess-coach/shared';
import type { ReactNode } from 'react';
import { CATEGORY_LABELS } from './categoryLabels.js';

export type TrendRange = 'last5' | 'last20';

export interface TrendChartProps {
  trends: MistakeTrend[];
  range: TrendRange;
  onRangeChange: (range: TrendRange) => void;
  onBarClick: (category: MistakeCategory) => void;
}

/** design.md §4.3: one bar per category, last-5/last-20 toggle, tap a bar to
 * see its findings. No color-coded good/bad — just the count. */
export function TrendChart({ trends, range, onRangeChange, onBarClick }: TrendChartProps): ReactNode {
  const maxCount = Math.max(1, ...trends.map((trend) => trend[range]));

  return (
    <div className="trend-chart">
      <div className="trend-chart__toggle" role="group" aria-label="Range">
        <button type="button" aria-pressed={range === 'last5'} onClick={() => onRangeChange('last5')}>
          Last 5
        </button>
        <button type="button" aria-pressed={range === 'last20'} onClick={() => onRangeChange('last20')}>
          Last 20
        </button>
      </div>
      {trends.length === 0 ? (
        <p>No mistakes recorded yet.</p>
      ) : (
        <div className="trend-chart__bars">
          {trends.map((trend) => {
            const count = trend[range];
            return (
              <button
                key={trend.category}
                type="button"
                className="trend-chart__bar"
                style={{ height: `${(count / maxCount) * 100}%` }}
                onClick={() => onBarClick(trend.category)}
              >
                {CATEGORY_LABELS[trend.category]}: {count}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
