import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDataStreamPart } from 'ai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChessboardOptions, PieceDropHandlerArgs } from 'react-chessboard';

const capturedOptions: ChessboardOptions[] = [];

vi.mock('react-chessboard', () => ({
  Chessboard: (props: { options: ChessboardOptions }) => {
    capturedOptions.push(props.options);
    return <div data-testid="mock-chessboard" />;
  }
}));

const { SessionPage } = await import('./SessionPage.js');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PGN = '[White "daniel"]\n[Black "Marta"]\n\n1. e4 e5 2. Nf3 *';

function mockMatchMedia(defaultMatches: boolean, overrides: Record<string, boolean> = {}) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: overrides[query] ?? defaultMatches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
}

function streamResponse(parts: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } });
}

interface SessionFixture {
  status?: 'active' | 'completed' | 'paused_no_credits';
  summary?: string | null;
  homework?: string | null;
  messages?: Array<{ id: string; role: 'user' | 'assistant' | 'tool'; content: unknown }>;
  classifiedMoves?: unknown[] | null;
}

// Most tests aren't about the fresh-session kickoff behavior — default to a
// session that already has an assistant turn so the auto-kickoff effect
// (which POSTs to /messages on mount) doesn't fire and steal/duplicate the
// fetch assertions those tests make. Tests exercising kickoff pass their own
// `messages` fixture with no assistant entry.
const ALREADY_STARTED_MESSAGES = [{ id: 'm0', role: 'assistant' as const, content: 'Hi there!' }];

function mockFetch(session: SessionFixture = {}, extra: (path: string) => Response | undefined = () => undefined) {
  return vi.fn().mockImplementation((path: string) => {
    const extraResponse = extra(path);
    if (extraResponse) return Promise.resolve(extraResponse);

    if (path === '/api/sessions/session-1') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'session-1',
            gameId: 'game-1',
            status: session.status ?? 'active',
            currentPly: 0,
            summary: session.summary ?? null,
            homework: session.homework ?? null,
            messages: session.messages ?? ALREADY_STARTED_MESSAGES
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    }
    if (path === '/api/games/game-1') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'game-1',
            pgn: PGN,
            userColor: 'black',
            whiteName: 'daniel',
            blackName: 'Marta',
            result: '1-0',
            classifiedMoves: session.classifiedMoves ?? null
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    }
    throw new Error(`unexpected fetch: ${path}`);
  });
}

function renderSessionPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/session/session-1']}>
        <Routes>
          <Route path="/session/:id" element={<SessionPage />} />
          <Route path="/games" element={<div>games-page-marker</div>} />
          <Route path="/dashboard" element={<div>dashboard-page-marker</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SessionPage', () => {
  beforeEach(() => {
    capturedOptions.length = 0;
    mockMatchMedia(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('loads the session and game, then renders the board oriented to the user color', async () => {
    vi.stubGlobal('fetch', mockFetch());
    renderSessionPage();

    await waitFor(() => expect(screen.getByTestId('mock-chessboard')).toBeInTheDocument());
    const options = capturedOptions.at(-1);
    expect(options?.position).toBe(START_FEN);
    expect(options?.boardOrientation).toBe('black');
  });

  test('dragging a move in answer mode shows a 2s undo pill, then sends [board_move]', async () => {
    const fetchMock = mockFetch({}, (path) =>
      path === '/api/sessions/session-1/messages' ? streamResponse([formatDataStreamPart('text', 'ok')]) : undefined
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    renderSessionPage();

    await vi.waitFor(() => expect(screen.getByTestId('mock-chessboard')).toBeInTheDocument());
    const options = capturedOptions.at(-1);
    act(() => {
      options?.onPieceDrop?.({
        piece: { pieceType: 'wP' },
        sourceSquare: 'e2',
        targetSquare: 'e4'
      } as PieceDropHandlerArgs);
    });

    expect(screen.getByText(/sending e4/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/sessions/session-1/messages')).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const messagesCall = fetchMock.mock.calls.find((call) => call[0] === '/api/sessions/session-1/messages');
    if (!messagesCall) throw new Error('expected a call to /api/sessions/session-1/messages');
    const body = JSON.parse((messagesCall[1] as RequestInit).body as string) as { content: string };
    expect(body.content).toMatch(/^\[board_move\] I played e4 \(position now: .+\)$/);
    vi.useRealTimers();
  });

  test('clicking undo within the 2s window cancels the send', async () => {
    const fetchMock = mockFetch({}, (path) =>
      path === '/api/sessions/session-1/messages' ? streamResponse([formatDataStreamPart('text', 'ok')]) : undefined
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    renderSessionPage();

    await vi.waitFor(() => expect(screen.getByTestId('mock-chessboard')).toBeInTheDocument());
    const options = capturedOptions.at(-1);
    act(() => {
      options?.onPieceDrop?.({
        piece: { pieceType: 'wP' },
        sourceSquare: 'e2',
        targetSquare: 'e4'
      } as PieceDropHandlerArgs);
    });

    act(() => {
      screen.getByRole('button', { name: /undo/i }).click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/sessions/session-1/messages')).toBe(false);
    expect(screen.queryByText(/sending e4/i)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test('a completed session renders the summary card instead of the board and chat', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 'completed', summary: 'Great progress on king safety.', homework: null }));
    const user = userEvent.setup();
    renderSessionPage();

    expect(await screen.findByText(/great progress on king safety/i)).toBeInTheDocument();
    expect(screen.queryByTestId('mock-chessboard')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to games/i }));
    expect(await screen.findByText('games-page-marker')).toBeInTheDocument();
  });

  test('reopening a session with prior turns shows the transcript, skipping the internal [session_start] marker', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        messages: [
          { id: 'm1', role: 'user', content: '[session_start]' },
          { id: 'm2', role: 'assistant', content: "Hi there! Let's dive into your game." },
          { id: 'm3', role: 'user', content: 'Sounds good.' }
        ]
      })
    );
    renderSessionPage();

    expect(await screen.findByText(/let's dive into your game/i)).toBeInTheDocument();
    expect(screen.getByText('Sounds good.')).toBeInTheDocument();
    expect(screen.queryByText('[session_start]')).not.toBeInTheDocument();
  });

  test('design.md §5.3: a persisted show_position tool-call reopens as a position divider', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        messages: [
          { id: 'm1', role: 'user', content: '[session_start]' },
          {
            id: 'm2',
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me show you.' },
              {
                type: 'tool-call',
                toolName: 'show_position',
                args: { moveNumber: 1, color: 'black' },
                toolCallId: 'call-1'
              }
            ]
          }
        ]
      })
    );
    renderSessionPage();

    expect(await screen.findByText(/let's dive into your game|let me show you/i)).toBeInTheDocument();
    const divider = within(screen.getByTestId('message-list')).getByText(/move 1 \(black\)/i).closest('.position-divider');
    expect(divider).toHaveTextContent('e5');

    const options = capturedOptions.at(-1);
    expect(options?.position).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  });

  test('a persisted show_position tool-call in the OLD {ply} shape (pre-move-number-fix data) still reopens correctly, not as NaN', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        messages: [
          { id: 'm1', role: 'user', content: '[session_start]' },
          {
            id: 'm2',
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me show you.' },
              { type: 'tool-call', toolName: 'show_position', args: { ply: 2 }, toolCallId: 'call-1' }
            ]
          }
        ]
      })
    );
    renderSessionPage();

    expect(await screen.findByText(/let's dive into your game|let me show you/i)).toBeInTheDocument();
    const divider = within(screen.getByTestId('message-list')).getByText(/move 1 \(black\)/i).closest('.position-divider');
    expect(divider).toHaveTextContent('e5');

    const options = capturedOptions.at(-1);
    expect(options?.position).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  });

  test('a fresh session (only the internal [session_start] marker, no assistant reply yet) auto-kicks off the coach opening turn', async () => {
    const fetchMock = mockFetch(
      { messages: [{ id: 'm1', role: 'user', content: '[session_start]' }] },
      (path) =>
        path === '/api/sessions/session-1/messages'
          ? streamResponse([formatDataStreamPart('text', 'Hi! Ready to dig into your game?')])
          : undefined
    );
    vi.stubGlobal('fetch', fetchMock);
    renderSessionPage();

    expect(await screen.findByText(/ready to dig into your game/i)).toBeInTheDocument();
    const messagesCall = fetchMock.mock.calls.find((call) => call[0] === '/api/sessions/session-1/messages');
    if (!messagesCall) throw new Error('expected a call to /api/sessions/session-1/messages');
    expect((messagesCall[1] as RequestInit).body).toBe(JSON.stringify({}));
  });

  test('clicking a position-divider then sending a message anchors there and tells the coach (design.md §5.3)', async () => {
    const fetchMock = mockFetch(
      {
        messages: [
          { id: 'm1', role: 'user', content: '[session_start]' },
          {
            id: 'm2',
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me show you.' },
              {
                type: 'tool-call',
                toolName: 'show_position',
                args: { moveNumber: 1, color: 'black' },
                toolCallId: 'call-1'
              }
            ]
          }
        ]
      },
      (path) => (path === '/api/sessions/session-1/messages' ? streamResponse([formatDataStreamPart('text', 'Sure.')]) : undefined)
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderSessionPage();

    expect(await screen.findByText(/let me show you/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /move 1 \(black\)/i }));

    await user.type(screen.getByRole('textbox', { name: /reply/i }), 'what should I look at here?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    const messagesCall = fetchMock.mock.calls
      .filter((call) => call[0] === '/api/sessions/session-1/messages')
      .at(-1);
    if (!messagesCall) throw new Error('expected a call to /api/sessions/session-1/messages');
    const body = JSON.parse((messagesCall[1] as RequestInit).body as string) as { content: string };
    expect(body.content).toBe('[position_context] Back at move 1 (black), after e5: what should I look at here?');
  });

  test('reopening a session that already has an assistant reply does not re-kick-off the coach', async () => {
    const fetchMock = mockFetch({
      messages: [
        { id: 'm1', role: 'user', content: '[session_start]' },
        { id: 'm2', role: 'assistant', content: 'Hi there!' }
      ]
    });
    vi.stubGlobal('fetch', fetchMock);
    renderSessionPage();

    expect(await screen.findByText('Hi there!')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/sessions/session-1/messages')).toBe(false);
  });

  test('on desktop (>=1080px), the move explorer panel renders with color-coded, NAG-annotated moves', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        classifiedMoves: [
          { ply: 1, moveSan: 'e4', mover: 'white', isUserMove: false, cpLoss: 0, quality: 'good', bestLineSan: ['e4'], evalAfterCp: 20 },
          {
            ply: 3,
            moveSan: 'Nf3',
            mover: 'white',
            isUserMove: false,
            cpLoss: 60,
            quality: 'dubious',
            bestLineSan: ['Bc4'],
            evalAfterCp: -40
          }
        ]
      })
    );
    renderSessionPage();

    expect(await screen.findByRole('button', { name: 'Nf3?!' })).toHaveClass('move-quality-dubious');
    expect(document.querySelector('.move-strip')).not.toBeInTheDocument();
  });

  test('below the 1080px desktop breakpoint, the move explorer panel is absent (flat MoveStrip still shows)', async () => {
    mockMatchMedia(true, { '(min-width: 1080px)': false });
    vi.stubGlobal('fetch', mockFetch());
    renderSessionPage();

    await screen.findByTestId('mock-chessboard');
    expect(document.querySelector('.move-explorer')).not.toBeInTheDocument();
    expect(screen.getByText('e4')).toBeInTheDocument();
  });

  test('a paused_no_credits session shows the add-credits card instead of the chat input', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 'paused_no_credits' }));
    renderSessionPage();

    expect(await screen.findByText(/session is saved/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /reply/i })).not.toBeInTheDocument();
  });
});
