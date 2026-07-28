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
  const queryClient = new QueryClient();
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
    ['/games', /games/i],
    ['/session/abc-123', /session/i],
    ['/dashboard', /progress/i],
    ['/settings', /settings/i]
  ])('renders the %s route', (path, expectedText) => {
    renderAt(path);
    expect(screen.getByRole('heading', { name: expectedText })).toBeInTheDocument();
  });

  test('redirects the root path to /games', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: /games/i })).toBeInTheDocument();
  });
});
