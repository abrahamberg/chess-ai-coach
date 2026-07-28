import { render, screen } from '@testing-library/react';
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
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(screen.getByRole('navigation', { name: /tab bar/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /icon rail/i })).not.toBeInTheDocument();
  });

  test('renders an icon rail at/above the 1080px desktop breakpoint', () => {
    mockMatchMedia(true);

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(screen.getByRole('navigation', { name: /icon rail/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /tab bar/i })).not.toBeInTheDocument();
  });

  test('always renders the page content', () => {
    mockMatchMedia(true);

    render(
      <AppShell>
        <div>unique-content-marker</div>
      </AppShell>
    );

    expect(screen.getByText('unique-content-marker')).toBeInTheDocument();
  });
});
