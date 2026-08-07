import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlayStartPage } from './PlayStartPage.js';

function renderPlayStartPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/play/new']}>
        <Routes>
          <Route path="/play/new" element={<PlayStartPage />} />
          <Route path="/session/:id" element={<div>session-page-marker</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PlayStartPage (architecture §14)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('renders a color picker', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderPlayStartPage();

    expect(screen.getByRole('button', { name: /play as white/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /play as black/i })).toBeInTheDocument();
  });

  test('picking a color POSTs /api/sessions/play with studentColor and navigates to the fresh session', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/sessions/play') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'session-9', mode: 'play' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPlayStartPage();

    await user.click(screen.getByRole('button', { name: /play as black/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sessions/play',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ studentColor: 'black' }) })
      )
    );
    expect(await screen.findByText('session-page-marker')).toBeInTheDocument();
  });

  test('a failed start shows an inline error instead of navigating', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPlayStartPage();

    await user.click(screen.getByRole('button', { name: /play as white/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('session-page-marker')).not.toBeInTheDocument();
  });
});
