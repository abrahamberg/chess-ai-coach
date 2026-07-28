import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('react-chessboard', () => ({
  Chessboard: () => <div data-testid="mock-chessboard" />
}));

const { ImportPage } = await import('./ImportPage.js');

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function renderImportPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/import']}>
        <Routes>
          <Route path="/import" element={<ImportPage />} />
          <Route path="/session/:id" element={<div>session-page-marker</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function submitPgn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /pgn/i }), '1. e4 e5');
  await user.click(screen.getByRole('button', { name: /import/i }));
}

describe('ImportPage', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a 422 missing-color response renders ColorConfirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ type: 'about:blank', title: 'x', status: 422, missing: 'userColor' }),
        { status: 422, headers: { 'content-type': 'application/problem+json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderImportPage();
    await submitPgn(user);

    expect(await screen.findByRole('button', { name: /white/i })).toBeInTheDocument();
  });

  test('once the analysis status SSE reports ready, a session is created and the app navigates to it', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/games') {
        return Promise.resolve(
          new Response(JSON.stringify({ gameId: 'game-1', analysisId: 'analysis-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
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
    const user = userEvent.setup();

    renderImportPage();
    await submitPgn(user);

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.instances[0]?.url).toBe('/api/analyses/analysis-1/status');

    MockEventSource.instances[0]?.emit({ status: 'ready' });

    expect(await screen.findByText('session-page-marker')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions',
      expect.objectContaining({ body: JSON.stringify({ gameId: 'game-1' }) })
    );
  });

  test('design.md §4.2: shows the 3-step analysis progress screen (not the form) while waiting', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/games') {
        return Promise.resolve(
          new Response(JSON.stringify({ gameId: 'game-1', analysisId: 'analysis-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderImportPage();
    await submitPgn(user);
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    expect(screen.queryByRole('textbox', { name: /pgn/i })).not.toBeInTheDocument();
    expect(screen.getByText('Reading game')).toBeInTheDocument();

    MockEventSource.instances[0]?.emit({ status: 'engine_running' });
    expect(await screen.findByText('Engine review')).toHaveAttribute('aria-current', 'step');
  });

  test('switching to the Lichess tab fetches and lists recent games; selecting one imports it as source lichess', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/lichess/recent-games') {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'g1',
                pgn: '1. e4 e5 1-0',
                whiteName: 'daniel',
                blackName: 'Marta',
                result: '1-0',
                timeControl: '600+0',
                playedAt: '2026-07-20T10:00:00.000Z'
              }
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      }
      if (path === '/api/games' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ gameId: 'game-2', analysisId: 'analysis-2' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderImportPage();
    await user.click(screen.getByRole('button', { name: /from lichess/i }));

    await user.click(await screen.findByRole('button', { name: /daniel.*marta/is }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/games',
        expect.objectContaining({ body: JSON.stringify({ pgn: '1. e4 e5 1-0', source: 'lichess' }) })
      )
    );
  });
});
