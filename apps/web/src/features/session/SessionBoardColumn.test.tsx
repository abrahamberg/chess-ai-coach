import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChessboardOptions, PieceDropHandlerArgs } from 'react-chessboard';
import type { ReactNode } from 'react';
import { SessionBoardColumn } from './SessionBoardColumn.js';
import { useDivergedLine } from './useDivergedLine.js';
import { useSessionBoardState } from './useSessionBoardState.js';
import { useWasmEngine } from '../../hooks/useWasmEngine.js';

const capturedOptions: ChessboardOptions[] = [];

vi.mock('react-chessboard', () => ({
  Chessboard: (props: { options: ChessboardOptions }) => {
    capturedOptions.push(props.options);
    return <div data-testid="mock-chessboard" />;
  }
}));

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const POSITIONS = [{ ply: 0, fen: START_FEN, moveUci: null }];

interface HarnessProps {
  sessionMode: 'analyze' | 'play';
  sendMessage?: (content: string) => void;
  onPlayMoveCommitted?: (result: { fen: string; san: string; ply: number }, uci: string) => void;
}

function Harness({ sessionMode, sendMessage = () => undefined, onPlayMoveCommitted = () => undefined }: HarnessProps): ReactNode {
  const boardState = useSessionBoardState(POSITIONS);
  const divergedLine = useDivergedLine();
  const engine = useWasmEngine();

  return (
    <SessionBoardColumn
      boardState={boardState}
      divergedLine={divergedLine}
      currentRealPosition={{ ply: boardState.ply, fen: boardState.fen }}
      orientation="white"
      sanMoves={[]}
      positions={POSITIONS}
      classifiedMoves={[]}
      isDesktop
      engine={engine}
      autoplayIntervalMs={1000}
      onChangeAutoplayInterval={() => undefined}
      sendMessage={sendMessage}
      onArrowsChange={() => undefined}
      sessionMode={sessionMode}
      sessionId="session-1"
      onPlayMoveCommitted={onPlayMoveCommitted}
    />
  );
}

function dropE2E4(): void {
  const options = capturedOptions.at(-1);
  act(() => {
    options?.onPieceDrop?.({
      piece: { pieceType: 'wP' },
      sourceSquare: 'e2',
      targetSquare: 'e4'
    } as PieceDropHandlerArgs);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('SessionBoardColumn — play mode (architecture §14)', () => {
  beforeEach(() => {
    capturedOptions.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a board drop commits the move via POST /play-move before sending the [player_move] chat message', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      calls.push(path);
      return Promise.resolve(jsonResponse({ fen: 'fen-after-e4', san: 'e4', ply: 1, quality: 'best' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const sendMessage = vi.fn((content: string) => calls.push(`sendMessage:${content}`));
    const onPlayMoveCommitted = vi.fn();

    render(<Harness sessionMode="play" sendMessage={sendMessage} onPlayMoveCommitted={onPlayMoveCommitted} />);
    await screen.findByTestId('mock-chessboard');

    dropE2E4();

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session-1/play-move',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ san: 'e4' }) })
    );
    expect(onPlayMoveCommitted).toHaveBeenCalledWith({ fen: 'fen-after-e4', san: 'e4', ply: 1, quality: 'best' }, 'e2e4');
    expect(sendMessage).toHaveBeenCalledWith('[player_move] I played e4.');
    // Ordering: the POST must resolve (and its result applied) before the chat turn starts.
    expect(calls).toEqual(['/api/sessions/session-1/play-move', 'sendMessage:[player_move] I played e4.']);
  });

  test('a 422 illegal-move rejection shows an inline error and never sends a chat message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ type: 'about:blank', title: 'Illegal move: e4', status: 422 }, 422)
    );
    vi.stubGlobal('fetch', fetchMock);
    const sendMessage = vi.fn();
    const onPlayMoveCommitted = vi.fn();

    render(<Harness sessionMode="play" sendMessage={sendMessage} onPlayMoveCommitted={onPlayMoveCommitted} />);
    await screen.findByTestId('mock-chessboard');

    dropE2E4();

    expect(await screen.findByText(/illegal move: e4/i)).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onPlayMoveCommitted).not.toHaveBeenCalled();
  });

  test('analyze mode never calls /play-move — a drop still goes through the existing diverged-line path', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const sendMessage = vi.fn();

    render(<Harness sessionMode="analyze" sendMessage={sendMessage} />);
    await screen.findByTestId('mock-chessboard');

    dropE2E4();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/undo last move/i)).toBeInTheDocument();
  });
});
