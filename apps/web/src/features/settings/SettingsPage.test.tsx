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
  creditBalance: 42,
  engineMode: 'native',
  coachPersona: 'general'
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

  test('editing the nickname PATCHes the profile with the new displayName', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/users/me' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse([]));
      if (path === '/api/users/me' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...PROFILE, displayName: 'Dani' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSettings(fetchMock);
    const user = userEvent.setup();

    await screen.findByText(/42/);
    await user.click(screen.getByRole('button', { name: /edit/i }));
    const nicknameInput = screen.getByRole('textbox', { name: /nickname/i });
    await user.clear(nicknameInput);
    await user.type(nicknameInput, 'Dani');
    const nicknameForm = nicknameInput.closest('form') as HTMLElement;
    await user.click(within(nicknameForm).getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Dani' }) })
      )
    );
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

  test('switching engine mode PATCHes /api/users/me with the new engineMode', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/users/me' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse([]));
      if (path === '/api/users/me' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...PROFILE, engineMode: 'browser' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSettings(fetchMock);
    const user = userEvent.setup();

    await screen.findByText(/42/);
    await user.click(screen.getByRole('radio', { name: /your browser/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ engineMode: 'browser' }) })
      )
    );
  });

  test('switching coach persona PATCHes /api/users/me with the new coachPersona', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/users/me' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse([]));
      if (path === '/api/users/me' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...PROFILE, coachPersona: 'gambler' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSettings(fetchMock);
    const user = userEvent.setup();

    await screen.findByText(/42/);
    await user.click(screen.getByRole('radio', { name: /the gambler/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ coachPersona: 'gambler' }) })
      )
    );
  });

  test('saving a lichess username PATCHes the profile', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/users/me' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse([]));
      if (path === '/api/users/me' && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string) as { lichessUsername?: string };
        return Promise.resolve(jsonResponse({ ...PROFILE, lichessUsername: body.lichessUsername ?? null }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSettings(fetchMock);
    const user = userEvent.setup();

    await screen.findByText(/42/);
    const lichessInput = screen.getByRole('textbox', { name: /lichess username/i });
    await user.type(lichessInput, 'my_lichess_handle');
    const lichessForm = lichessInput.closest('form') as HTMLElement;
    await user.click(within(lichessForm).getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ lichessUsername: 'my_lichess_handle' }) })
      )
    );
  });

  test('deleting a lichess username PATCHes the profile with lichessUsername: null', async () => {
    const profileWithLichess = { ...PROFILE, lichessUsername: 'my_lichess_handle' };
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/users/me' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(profileWithLichess));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse([]));
      if (path === '/api/users/me' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...profileWithLichess, lichessUsername: null }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    renderSettings(fetchMock);
    const user = userEvent.setup();

    await screen.findByText(/42/);
    const lichessRow = screen.getByText(/my_lichess_handle/).closest('p') as HTMLElement;
    await user.click(within(lichessRow).getByRole('button', { name: /delete/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/users/me',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ lichessUsername: null }) })
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

  test('renders a sign-out link that ends the oauth2-proxy session and returns to the landing page', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/users/me') return Promise.resolve(jsonResponse(PROFILE));
      if (path === '/api/users/me/llm-keys') return Promise.resolve(jsonResponse([]));
      throw new Error(`unexpected fetch: ${path}`);
    });
    renderSettings(fetchMock);

    await screen.findByText(/42/);
    expect(screen.getByRole('link', { name: /sign out/i })).toHaveAttribute('href', '/oauth2/sign_out?rd=/');
  });
});
