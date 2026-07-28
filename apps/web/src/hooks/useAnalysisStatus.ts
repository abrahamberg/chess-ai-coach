import { useEffect, useState } from 'react';

export interface AnalysisStatusEvent {
  status: string;
}

/** Consumes GET /api/analyses/:id/status (SSE). Returns null until the first
 * status frame arrives; reconnects whenever `analysisId` changes. */
export function useAnalysisStatus(analysisId: string | null): { status: string | null } {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!analysisId) return;

    setStatus(null);
    const source = new EventSource(`/api/analyses/${analysisId}/status`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as AnalysisStatusEvent;
      setStatus(data.status);
    };

    return () => source.close();
  }, [analysisId]);

  return { status };
}
