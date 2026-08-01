import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SettingsPage } from './SettingsPage.js';

const PROFILE = {
  id: '7d9f2a44-9a5f-4f6e-b1a1-0a4c1e2d3f4b',
  email: 'daniel@example.com',
  displayName: 'daniel',
  ratingBand: 'club',
  lichessUsername: null,
  chesscomUsername: null,
  selfAssessment: null,
  showEngineAnalysis: false,
  creditBalance: 42
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renderSettings(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

describe('SettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('renders the profile band, credit balance, and which provider has a saved key', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/users/me') return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse(['anthropic']));
      throw new Error(`unexpected fetch: ${path}`);
    });
    renderSettings(fetchMock);

    expect(await screen.findByText(/42/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /club/i })).toBeChecked();
    const anthropicSection = screen.getByText('Anthropic').closest('div') as HTMLElement;
    expect(anthropicSection).toHaveTextContent(/saved/i);
    const openaiSection = screen.getByText('OpenAI').closest('div') as HTMLElement;
    expect(openaiSection).toHaveTextContent(/add key/i);
  });

  test('changing the rating band PATCHes the profile', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/users/me' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse([]));
      if (path === '/api/users/me' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...PROFILE, ratingBand: 'advanced' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSettings(fetchMock);
    const user = userEvent.setup();

    await screen.findByText(/42/);
    await user.click(screen.getByRole('radio', { name: /advanced/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ ratingBand: 'advanced' }) })
      )
    );
  });

  test('toggling engine analysis PATCHes the profile, off by default', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/users/me' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse([]));
      if (path === '/api/users/me' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...PROFILE, showEngineAnalysis: true }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSettings(fetchMock);
    const user = userEvent.setup();

    await screen.findByText(/42/);
    const toggle = screen.getByRole('checkbox', { name: /show engine analysis/i });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ showEngineAnalysis: true }) })
      )
    );
  });

  test('saving an API key PUTs it, then the provider shows as saved', async () => {
    let savedProviders: string[] = [];
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/users/me') return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(savedProviders));
      }
      if (path === '/api/users/me/llm-keys/openai' && init?.method === 'PUT') {
        savedProviders = ['openai'];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSettings(fetchMock);
    const user = userEvent.setup();

    await screen.findByText(/42/);
    const openaiForm = screen.getByText('OpenAI').closest('div') as HTMLElement;
    await user.type(within(openaiForm).getByRole('textbox', { name: /api key/i }), 'sk-oai-secret');
    await user.click(within(openaiForm).getByRole('button', { name: /add key/i }));

    await waitFor(() => {
      const openaiSection = screen.getByText('OpenAI').closest('div') as HTMLElement;
      expect(openaiSection).toHaveTextContent(/saved/i);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/me/llm-keys/openai',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ apiKey: 'sk-oai-secret' }) })
    );
  });
});
