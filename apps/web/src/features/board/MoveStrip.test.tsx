import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PositionAnalysis } from '@chess-coach/shared';
import { MoveStrip } from './MoveStrip.js';

const SAN_MOVES = ['e4', 'e5', 'Nf3', 'Nc6'];

const ANALYSIS_FIXTURE: PositionAnalysis = {
  fen: 'fen-after-e4',
  depth: 16,
  multiPv: 1,
  bestMove: 'e5',
  eval: { cp: 20, mateIn: null },
  lines: [],
  features: {
    turn: 'black',
    boardState: 'none',
    availableMoves: ['e5'],
    mobility: { white: 20, black: 20 },
    controlledSquares: [],
    piecesUnderAttack: [],
    hangingPieces: [],
    underDefendedPieces: [],
    overloadedDefenders: [],
    centerControlScore: { white: 0, black: 0 },
    openFiles: [],
    semiOpenFiles: [],
    doubledPawns: [],
    isolatedPawns: [],
    passedPawns: [],
    targetsAttacked: [],
    forks: [],
    captureOpportunities: []
  }
};

describe('MoveStrip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('long-pressing a chip opens the analysis inspector with its saved analysis', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(ANALYSIS_FIXTURE), { status: 200, headers: { 'content-type': 'application/json' } })
      );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const positions = [{ ply: 1, fen: 'fen-after-e4' }];

    render(
      <QueryClientProvider client={queryClient}>
        <MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} positions={positions} currentPly={0} momentPlies={[]} onSelect={vi.fn()} />
      </QueryClientProvider>
    );

    const chip = screen.getByText('e4');
    fireEvent.pointerDown(chip);
    await new Promise((resolve) => setTimeout(resolve, 600));
    fireEvent.pointerUp(chip);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/positions/analyze',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ fen: 'fen-after-e4' }) })
    );
  });

  test('releasing before the long-press threshold does not open the inspector', async () => {
    const positions = [{ ply: 1, fen: 'fen-after-e4' }];
    render(
      <MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} positions={positions} currentPly={0} momentPlies={[]} onSelect={vi.fn()} />
    );

    const chip = screen.getByText('e4');
    fireEvent.pointerDown(chip);
    fireEvent.pointerUp(chip);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  test('renders move numbers and SAN, marking the current ply', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} positions={[]} currentPly={2} momentPlies={[]} onSelect={vi.fn()} />);

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    const current = screen.getByText('Nf3');
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('e5')).not.toHaveAttribute('aria-current');
  });

  test('marks moment plies with a dot', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} positions={[]} currentPly={0} momentPlies={[3]} onSelect={vi.fn()} />);
    expect(screen.getByText('Nc6')).toHaveClass('moment');
  });

  test('tapping a move calls onSelect with its ply', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} positions={[]} currentPly={0} momentPlies={[]} onSelect={onSelect} />);

    await user.click(screen.getByText('Nc6'));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  test('renders a quality badge on the chip matching ClassifiedMoveDto.ply (1-based), not the local 0-based index', () => {
    const classifiedMoves = [
      {
        ply: 3,
        moveSan: 'Nf3',
        mover: 'white' as const,
        isUserMove: false,
        cpLoss: 400,
        quality: 'blunder' as const,
        bestLineSan: ['Nc3'],
        evalAfterCp: -400,
        hangsPiece: false
      }
    ];
    render(
      <MoveStrip sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} positions={[]} currentPly={0} momentPlies={[]} onSelect={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: /nf3/i })).toHaveClass('move-quality-blunder');
    expect(screen.getByRole('button', { name: /nc6/i }).className).not.toMatch(/move-quality-/);
  });

  test('renders no quality class for a chip with no matching classified move', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} positions={[]} currentPly={0} momentPlies={[]} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'e4' }).className).not.toMatch(/move-quality-/);
  });
});
