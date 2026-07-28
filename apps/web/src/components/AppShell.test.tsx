import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AppShell } from './AppShell.js';

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  }));
}

describe('AppShell (design.md §3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders a bottom tab bar below the 1080px desktop breakpoint', () => {
    mockMatchMedia(false);

    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(screen.getByRole('navigation', { name: /tab bar/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /icon rail/i })).not.toBeInTheDocument();
  });

  test('renders an icon rail at/above the 1080px desktop breakpoint', () => {
    mockMatchMedia(true);

    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(screen.getByRole('navigation', { name: /icon rail/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /tab bar/i })).not.toBeInTheDocument();
  });

  test('always renders the page content', () => {
    mockMatchMedia(true);

    render(
      <MemoryRouter>
        <AppShell>
          <div>unique-content-marker</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(screen.getByText('unique-content-marker')).toBeInTheDocument();
  });
});
