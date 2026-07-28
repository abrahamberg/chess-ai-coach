import { DashboardResponseSchema } from '@chess-coach/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api/client.js';
import { FocusAreaCard } from './FocusAreaCard.js';
import { SessionHistory } from './SessionHistory.js';
import { TrendChart, type TrendRange } from './TrendChart.js';

/** design.md §4.3: Progress dashboard — focus areas, mistake trends, session
 * history. Owns fetching (AGENTS.md rule 7); every child is presentational. */
export function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const [range, setRange] = useState<TrendRange>('last20');
  const [resolvedOpen, setResolvedOpen] = useState(false);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet('/api/users/me/dashboard', DashboardResponseSchema)
  });

  if (dashboardQuery.isLoading) return <p>Loading…</p>;
  if (dashboardQuery.isError || !dashboardQuery.data) return <p>Could not load your progress.</p>;

  const { focusAreas, mistakeTrends, sessionHistory } = dashboardQuery.data;

  // design.md §4.3: tapping a bar lists its contributing findings — no
  // findings-detail view exists yet, so this is a no-op for now.
  function handleBarClick(): void {}

  return (
    <div className="dashboard-page">
      <section aria-label="Focus areas">
        {focusAreas.active.length === 0 ? (
          <p>No focus areas yet — they'll appear as the coach spots patterns.</p>
        ) : (
          focusAreas.active.map((area) => <FocusAreaCard key={area.category} area={area} />)
        )}
        {focusAreas.resolved.length > 0 && (
          <div className="dashboard-page__resolved">
            <button type="button" onClick={() => setResolvedOpen((open) => !open)}>
              Resolved ✓ ({focusAreas.resolved.length})
            </button>
            {resolvedOpen &&
              focusAreas.resolved.map((area) => <FocusAreaCard key={area.category} area={area} />)}
          </div>
        )}
      </section>

      <section aria-label="Mistake trends">
        <TrendChart trends={mistakeTrends} range={range} onRangeChange={setRange} onBarClick={handleBarClick} />
      </section>

      <section aria-label="Session history">
        <SessionHistory sessions={sessionHistory} onSelect={(sessionId) => navigate(`/session/${sessionId}`)} />
      </section>
    </div>
  );
}
