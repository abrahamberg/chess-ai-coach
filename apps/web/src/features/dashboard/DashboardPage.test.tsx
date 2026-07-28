import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DashboardPage } from './DashboardPage.js';

const DASHBOARD_RESPONSE = {
  focusAreas: {
    active: [
      {
        category: 'king_safety',
        status: 'improving',
        note: 'Delays castling under pressure.',
        evidenceCount: 3,
        lastSeenAt: '2026-07-20T10:00:00.000Z'
      }
    ],
    resolved: [
      {
        category: 'passive_play',
        status: 'resolved',
        note: 'Fixed it.',
        evidenceCount: 4,
        lastSeenAt: '2026-07-10T10:00:00.000Z'
      }
    ]
  },
  mistakeTrends: [{ category: 'king_safety', last5: 1, last20: 4 }],
  sessionHistory: [
    {
      sessionId: 's1',
      gameId: 'g1',
      startedAt: '2026-07-20T10:00:00.000Z',
      whiteName: 'daniel',
      blackName: 'Marta',
      userColor: 'white',
      result: '1-0',
      summary: 'Worked on king safety today.',
      homework: 'Solve 10 rook-endgame puzzles.'
    }
  ]
};

function renderDashboard() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(DASHBOARD_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } })
  );
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/session/:id" element={<div>session-page-marker</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return fetchMock;
}

describe('DashboardPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('fetches the dashboard and renders focus areas, trends, and session history', async () => {
    const fetchMock = renderDashboard();

    await screen.findByRole('heading', { name: /king safety/i });
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me/dashboard', expect.anything());
    expect(screen.getByText(/worked on king safety today/i)).toBeInTheDocument();
  });

  test('resolved focus areas start collapsed behind a "Resolved" accordion', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('heading', { name: /king safety/i });

    expect(screen.queryByText(/passive play/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /resolved/i }));
    expect(screen.getByText(/passive play/i)).toBeInTheDocument();
  });

  test('tapping a session history row navigates to the session', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText(/worked on king safety today/i);

    await user.click(screen.getByText(/worked on king safety today/i));
    expect(await screen.findByText('session-page-marker')).toBeInTheDocument();
  });
});
