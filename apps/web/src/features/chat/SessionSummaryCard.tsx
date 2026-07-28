import type { ReactNode } from 'react';

export interface SessionSummaryCardProps {
  summary: string;
  homework: string | null;
  onBackToGames: () => void;
  onViewProgress: () => void;
}

/** design.md §5.3: session-end card — coach summary + homework chip + CTAs. */
export function SessionSummaryCard({
  summary,
  homework,
  onBackToGames,
  onViewProgress
}: SessionSummaryCardProps): ReactNode {
  return (
    <div className="session-summary-card">
      <p>{summary}</p>
      {homework && (
        <p className="homework-chip">
          <span aria-hidden="true">☐</span> Homework: {homework}
        </p>
      )}
      <button type="button" onClick={onBackToGames}>
        Back to Games
      </button>
      <button type="button" onClick={onViewProgress}>
        View Progress
      </button>
    </div>
  );
}
