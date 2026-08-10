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
import { ImportErrorNotice } from './ImportErrorNotice.js';
import { LichessGamePicker } from './LichessGamePicker.js';
import { PgnPasteForm } from './PgnPasteForm.js';
import { PgnUploadForm } from './PgnUploadForm.js';
import './ImportPage.css';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function finalFenOf(pgn: string): string {
  return fensOf(pgn).at(-1) ?? START_FEN;
}

/** The denominator for the engine step's percentage. The API reports how many
 * positions it has analyzed, not how many there are, because the client
 * already holds the PGN — so the total is derived here rather than shipped. */
function positionCountOf(pgn: string): number {
  return fensOf(pgn).length;
}

/** Every position's FEN, index-aligned with ply — lets AnalysisProgress show
 * the position currently being analyzed instead of just the final one. */
function fensOf(pgn: string): string[] {
  try {
    return parsePgn(pgn).positions.map((position) => position.fen);
  } catch {
    return [];
  }
}

const SessionSummarySchema = z.object({ id: z.string() });
type ImportTab = 'paste' | 'upload' | 'lichess';

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

  const { status, analyzedPositions } = useAnalysisStatus(analysisId);

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

  // Every import failure that ISN'T the 422 "which colour were you?" prompt
  // (ColorConfirm handles that one below). Without this the mutation's error
  // state rendered nothing at all, so a rate-limited import — 429 "Import limit
  // reached (10 games/day)" — looked exactly like a dead button: press it, and
  // the page just sits there.
  const importError = missingColor ? null : importMutation.error;

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
        <AnalysisProgress
          status={status}
          finalFen={finalFenOf(pendingPgn ?? '')}
          onRetry={retry}
          analyzedPositions={analyzedPositions}
          totalPositions={positionCountOf(pendingPgn ?? '')}
          positions={fensOf(pendingPgn ?? '')}
        />
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
          {importError && <ImportErrorNotice error={importError} />}
          <div role="tablist">
            <button type="button" aria-pressed={tab === 'paste'} onClick={() => setTab('paste')}>
              Paste
            </button>
            <button type="button" aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>
              Upload
            </button>
            <button type="button" aria-pressed={tab === 'lichess'} onClick={() => setTab('lichess')}>
              From Lichess
            </button>
          </div>
          {tab === 'paste' && <PgnPasteForm onSubmit={(body) => importPgn(body.pgn, body.source, body.userColor)} />}
          {tab === 'upload' && <PgnUploadForm onSubmit={(body) => importPgn(body.pgn, body.source)} />}
          {tab === 'lichess' && (
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
