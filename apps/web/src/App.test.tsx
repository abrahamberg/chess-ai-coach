import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { AppRoutes } from './App.js';

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
}

function renderAt(path: string) {
  mockMatchMedia(false);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppRoutes', () => {
  test.each([
    ['/import', /import/i],
    ['/games', /games/i]
  ])('renders the %s route', (path, expectedText) => {
    renderAt(path);
    expect(screen.getByRole('heading', { name: expectedText })).toBeInTheDocument();
  });

  test.each([
    ['/session/:id', '/session/abc-123'],
    ['/dashboard', '/dashboard'],
    ['/settings', '/settings']
  ])('renders the %s route (page owns its own fetching, error state shown when unavailable)', async (_route, path) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable in this test')));
    renderAt(path);
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  test('redirects the root path to /games', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: /games/i })).toBeInTheDocument();
  });
});
