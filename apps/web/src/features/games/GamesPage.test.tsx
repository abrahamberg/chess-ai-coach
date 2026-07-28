import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { GamesPage } from './GamesPage.js';

const GAMES_RESPONSE = [
  {
    id: 'g1',
    userColor: 'white',
    whiteName: 'daniel',
    blackName: 'Marta',
    result: '1-0',
    timeControl: '10+0',
    playedAt: '2026-07-20T10:00:00.000Z',
    createdAt: '2026-07-20T10:05:00.000Z',
    analysisStatus: 'ready'
  }
];

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

  test('shows a friendly empty state with no games and no dummy data', async () => {
    renderGamesPage([]);
    expect(await screen.findByText(/no games yet|analyze your first game/i)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
