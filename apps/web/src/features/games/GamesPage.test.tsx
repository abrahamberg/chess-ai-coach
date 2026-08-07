import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { GamesPage } from './GamesPage.js';

const GAMES_RESPONSE = [
  {
    id: 'g1',
    source: 'paste',
    userColor: 'white',
    whiteName: 'daniel',
    blackName: 'Marta',
    result: '1-0',
    timeControl: '10+0',
    playedAt: '2026-07-20T10:00:00.000Z',
    createdAt: '2026-07-20T10:05:00.000Z',
    analysisStatus: 'ready',
    sessionId: null
  }
];

const PLAY_MODE_GAME = {
  id: 'g2',
  source: 'coach_play',
  userColor: 'white',
  whiteName: 'daniel',
  blackName: 'Coach',
  result: null,
  timeControl: null,
  playedAt: null,
  createdAt: '2026-08-05T10:05:00.000Z',
  analysisStatus: null,
  sessionId: 'session-2'
};

function renderGamesPage(games: unknown[] = GAMES_RESPONSE) {
  const fetchMock = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/games') {
      return Promise.resolve(
        new Response(JSON.stringify(games), { status: 200, headers: { 'content-type': 'application/json' } })
      );
    }
    if (path === '/api/sessions') {
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'session-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }
    throw new Error(`unexpected fetch: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/games']}>
        <Routes>
          <Route path="/games" element={<GamesPage />} />
          <Route path="/import" element={<div>import-page-marker</div>} />
          <Route path="/play/new" element={<div>play-start-page-marker</div>} />
          <Route path="/session/:id" element={<div>session-page-marker</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return fetchMock;
}

describe('GamesPage (design.md §4.1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('fetches and lists the user\'s games', async () => {
    renderGamesPage();
    expect(await screen.findByText('daniel')).toBeInTheDocument();
    expect(screen.getByText('Marta')).toBeInTheDocument();
  });

  test('the "Analyze a game" CTA navigates to Import', async () => {
    const user = userEvent.setup();
    renderGamesPage();
    await screen.findByText('daniel');

    await user.click(screen.getByRole('link', { name: /analyze a game/i }));
    expect(await screen.findByText('import-page-marker')).toBeInTheDocument();
  });

  // architecture §14: the second entry point into a coaching session — a
  // live game against the coach, rather than reviewing an imported one.
  test('the "Play the coach" CTA navigates to the play-mode start page', async () => {
    const user = userEvent.setup();
    renderGamesPage();
    await screen.findByText('daniel');

    await user.click(screen.getByRole('link', { name: /play the coach/i }));
    expect(await screen.findByText('play-start-page-marker')).toBeInTheDocument();
  });

  test('tapping a ready row starts a session and navigates to it', async () => {
    const user = userEvent.setup();
    const fetchMock = renderGamesPage();
    await screen.findByText('daniel');

    await user.click(screen.getByRole('button', { name: /daniel.*marta/is }));

    expect(await screen.findByText('session-page-marker')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions',
      expect.objectContaining({ body: JSON.stringify({ gameId: 'g1' }) })
    );
  });

  // architecture §14: a coach_play row must link back into its existing
  // session directly, never through analyze mode's gated POST /api/sessions
  // (which would 409 — a play-mode game never has an `analyses` row).
  test('tapping an in-progress play-mode row navigates straight to its session', async () => {
    const user = userEvent.setup();
    const fetchMock = renderGamesPage([PLAY_MODE_GAME]);
    await screen.findByText('daniel');

    await user.click(screen.getByRole('button', { name: /daniel.*coach/is }));

    expect(await screen.findByText('session-page-marker')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions', expect.anything());
  });

  test('shows a friendly empty state with no games and no dummy data', async () => {
    renderGamesPage([]);
    expect(await screen.findByText(/no games yet|analyze your first game/i)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
