import { parsePgn } from '@chess-coach/chess-analysis';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import {
  ImportGameRequestSchema,
  ImportGameResponseSchema,
  LichessRecentGamesResponseSchema,
  type ImportGameRequest,
  type PlayerColor
} from '@chess-coach/shared';
import { apiGet, apiPost, ApiError } from '../../api/client.js';
import { useAnalysisStatus } from '../../hooks/useAnalysisStatus.js';
import { AnalysisProgress } from './AnalysisProgress.js';
import { ColorConfirm } from './ColorConfirm.js';
import { LichessGamePicker } from './LichessGamePicker.js';
import { PgnPasteForm } from './PgnPasteForm.js';
import './ImportPage.css';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function finalFenOf(pgn: string): string {
  try {
    const { positions } = parsePgn(pgn);
    return positions.at(-1)?.fen ?? START_FEN;
  } catch {
    return START_FEN;
  }
}

const SessionSummarySchema = z.object({ id: z.string() });
type ImportTab = 'paste' | 'lichess';

/** Import a game, watch its analysis (SSE), and hand off into a coaching
 * session once it's ready. Composes PgnPasteForm + ColorConfirm; no fetching
 * lives in either presentational child (AGENTS.md rule 7). */
export function ImportPage(): ReactNode {
  const navigate = useNavigate();
  const [pendingPgn, setPendingPgn] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [tab, setTab] = useState<ImportTab>('paste');

  const importMutation = useMutation({
    mutationFn: (body: ImportGameRequest) => apiPost('/api/games', body, ImportGameResponseSchema),
    onSuccess: (data) => {
      setGameId(data.gameId);
      setAnalysisId(data.analysisId);
    }
  });

  const sessionMutation = useMutation({
    mutationFn: (forGameId: string) => apiPost('/api/sessions', { gameId: forGameId }, SessionSummarySchema),
    onSuccess: (session) => navigate(`/session/${session.id}`)
  });

  const { status } = useAnalysisStatus(analysisId);

  const lichessQuery = useQuery({
    queryKey: ['lichess-recent-games'],
    queryFn: ({ signal }) => apiGet('/api/lichess/recent-games', LichessRecentGamesResponseSchema, signal),
    enabled: tab === 'lichess'
  });
  const lichessNotLinked = lichessQuery.error instanceof ApiError && lichessQuery.error.status === 404;

  useEffect(() => {
    if (status === 'ready' && gameId && !sessionMutation.isPending && !sessionMutation.isSuccess) {
      sessionMutation.mutate(gameId);
    }
  }, [status, gameId, sessionMutation]);

  const missingColor =
    importMutation.error instanceof ApiError &&
    importMutation.error.status === 422 &&
    (importMutation.error.body as { missing?: string } | undefined)?.missing === 'userColor';

  function importPgn(pgn: string, source: ImportGameRequest['source'] = 'paste', userColor?: PlayerColor): void {
    const body = ImportGameRequestSchema.parse({ pgn, source, userColor });
    setPendingPgn(pgn);
    importMutation.mutate(body);
  }

  function retry(): void {
    setGameId(null);
    setAnalysisId(null);
    importMutation.reset();
  }

  if (gameId && analysisId) {
    return (
      <div className="page import-page">
        <h1>Import a game</h1>
        <AnalysisProgress status={status} finalFen={finalFenOf(pendingPgn ?? '')} onRetry={retry} />
      </div>
    );
  }

  return (
    <div className="page import-page">
      <h1>Import a game</h1>
      {missingColor && pendingPgn ? (
        <ColorConfirm onConfirm={(color) => importPgn(pendingPgn, 'paste', color)} />
      ) : (
        <>
          <div role="tablist">
            <button type="button" aria-pressed={tab === 'paste'} onClick={() => setTab('paste')}>
              Paste
            </button>
            <button type="button" aria-pressed={tab === 'lichess'} onClick={() => setTab('lichess')}>
              From Lichess
            </button>
          </div>
          {tab === 'paste' ? (
            <PgnPasteForm onSubmit={(body) => importPgn(body.pgn, body.source, body.userColor)} />
          ) : (
            <LichessGamePicker
              games={lichessQuery.data ?? []}
              isLoading={lichessQuery.isLoading}
              isLinked={!lichessNotLinked}
              onSelect={(pgn) => importPgn(pgn, 'lichess')}
            />
          )}
        </>
      )}
    </div>
  );
}
