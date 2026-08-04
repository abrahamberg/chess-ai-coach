import { useQuery } from '@tanstack/react-query';
import { PositionAnalysisSchema } from '@chess-coach/shared';
import { apiPost } from '../../api/client.js';

/** Fetches the saved/cached engine analysis for a single position (the
 * inspector's data source, POST /api/positions/analyze) — cache-first
 * server-side against position_evaluations, so this is normally fast once
 * the background deepen-analysis pass has reached this position. */
export function usePositionAnalysis(fen: string | null) {
  return useQuery({
    queryKey: ['position-analysis', fen],
    queryFn: () => apiPost('/api/positions/analyze', { fen }, PositionAnalysisSchema),
    enabled: fen !== null
  });
}
