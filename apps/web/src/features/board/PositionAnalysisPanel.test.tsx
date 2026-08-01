import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PositionAnalysis, PositionFeatures } from '@chess-coach/shared';
import { PositionAnalysisPanel } from './PositionAnalysisPanel.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function analysisFixture(
  overrides: Partial<Omit<PositionAnalysis, 'features'>> & { features?: Partial<PositionFeatures> } = {}
): PositionAnalysis {
  const { features: featureOverrides, ...rest } = overrides;
  return {
    fen: START_FEN,
    depth: 16,
    multiPv: 1,
    bestMove: 'e4',
    eval: { cp: 35, mateIn: null },
    lines: [{ moveUci: 'e2e4', moveSan: 'e4', pvSan: ['e4', 'e5', 'Nf3'], cp: 35, mateIn: null }],
    ...rest,
    features: {
      turn: 'white',
      boardState: 'none',
      availableMoves: ['e4'],
      mobility: { white: 20, black: 20 },
      controlledSquares: [],
      piecesUnderAttack: [],
      hangingPieces: [{ square: 'd1', piece: 'q', color: 'white', attackers: 1, defenders: 0 }],
      underDefendedPieces: [],
      overloadedDefenders: [],
      centerControlScore: { white: 2, black: 2 },
      openFiles: [],
      semiOpenFiles: [],
      doubledPawns: [],
      isolatedPawns: [],
      passedPawns: [],
      targetsAttacked: [],
      forks: [],
      captureOpportunities: [],
      ...featureOverrides
    }
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renderPanel(fetchMock: ReturnType<typeof vi.fn>, props: { fen?: string; enabled?: boolean } = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PositionAnalysisPanel fen={props.fen ?? START_FEN} enabled={props.enabled ?? true} />
    </QueryClientProvider>
  );
}

describe('PositionAnalysisPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('renders nothing and never fetches when disabled', () => {
    const fetchMock = vi.fn();
    renderPanel(fetchMock, { enabled: false });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/analyzing/i)).not.toBeInTheDocument();
  });

  test('fetches /api/positions/analyze and renders the eval, best move, and PV once enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(analysisFixture()));
    renderPanel(fetchMock);

    expect(await screen.findByText(/best: e4/i)).toBeInTheDocument();
    expect(screen.getByText('+0.35 · best: e4')).toBeInTheDocument();
    expect(screen.getByText('e4 e5 Nf3')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/positions/analyze',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ fen: START_FEN }) })
    );
  });

  test('renders hanging pieces when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(analysisFixture()));
    renderPanel(fetchMock);

    expect(await screen.findByText('Hanging pieces')).toBeInTheDocument();
    expect(screen.getByText(/white q on d1/i)).toBeInTheDocument();
  });

  test('omits a feature section entirely when its list is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(analysisFixture({ features: { hangingPieces: [] } })));
    renderPanel(fetchMock);

    await screen.findByText(/best: e4/i);
    expect(screen.queryByText('Hanging pieces')).not.toBeInTheDocument();
  });

  test('shows mate-in text instead of a centipawn figure for a forced mate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(analysisFixture({ bestMove: 'Qh4#', eval: { cp: null, mateIn: 1 } })));
    renderPanel(fetchMock);

    expect(await screen.findByText(/mate in 1/i)).toBeInTheDocument();
  });
});
