import { SavedLlmProvidersResponseSchema, UserProfileSchema, type EngineMode, type LlmProvider, type RatingBand } from '@chess-coach/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { apiDelete, apiGet, apiPatch, apiPut } from '../../api/client.js';
import { BandSelect } from './BandSelect.js';
import { ByokKeyForm } from './ByokKeyForm.js';
import { CreditBalance } from './CreditBalance.js';
import { EngineModeSelect } from './EngineModeSelect.js';
import './SettingsPage.css';

type Theme = 'light' | 'dark';
const THEME_STORAGE_KEY = 'chess-coach-theme';
const LLM_PROVIDERS: LlmProvider[] = ['anthropic', 'openai'];

function readStoredTheme(): Theme | null {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

/** design.md §4.4: Settings — Profile, API keys, Credits, Appearance, Account.
 * Owns fetching (AGENTS.md rule 7); every child below is presentational. */
export function SettingsPage(): ReactNode {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<Theme | null>(() => readStoredTheme());

  useEffect(() => {
    if (theme) {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } else {
      delete document.documentElement.dataset.theme;
    }
  }, [theme]);

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: ({ signal }) => apiGet('/api/users/me', UserProfileSchema, signal)
  });
  const providersQuery = useQuery({
    queryKey: ['llm-keys'],
    queryFn: ({ signal }) => apiGet('/api/users/me/llm-keys', SavedLlmProvidersResponseSchema, signal)
  });

  const bandMutation = useMutation({
    mutationFn: (ratingBand: RatingBand) => apiPatch('/api/users/me', { ratingBand }, UserProfileSchema),
    onSuccess: (profile) => queryClient.setQueryData(['profile'], profile)
  });

  const engineModeMutation = useMutation({
    mutationFn: (engineMode: EngineMode) => apiPatch('/api/users/me', { engineMode }, UserProfileSchema),
    onSuccess: (profile) => queryClient.setQueryData(['profile'], profile)
  });

  const saveKeyMutation = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: LlmProvider; apiKey: string }) =>
      apiPut(`/api/users/me/llm-keys/${provider}`, { apiKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['llm-keys'] })
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (provider: LlmProvider) => apiDelete(`/api/users/me/llm-keys/${provider}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['llm-keys'] })
  });

  if (profileQuery.isLoading || providersQuery.isLoading) return <p>Loading…</p>;
  if (profileQuery.isError || !profileQuery.data || providersQuery.isError || !providersQuery.data) {
    return <p>Could not load your settings.</p>;
  }

  const profile = profileQuery.data;
  const savedProviders = new Set(providersQuery.data);

  return (
    <div className="page settings-page">
      <section aria-label="Profile">
        <h2>Profile</h2>
        <p>{profile.displayName}</p>
        <BandSelect value={profile.ratingBand} onChange={(band) => bandMutation.mutate(band)} />
      </section>

      <section aria-label="Engine">
        <h2>Engine</h2>
        <EngineModeSelect value={profile.engineMode} onChange={(mode) => engineModeMutation.mutate(mode)} />
      </section>

      <section aria-label="API keys">
        <h2>API keys</h2>
        {LLM_PROVIDERS.map((provider) => (
          <ByokKeyForm
            key={provider}
            provider={provider}
            isSaved={savedProviders.has(provider)}
            onSave={(apiKey) => saveKeyMutation.mutate({ provider, apiKey })}
            onDelete={() => deleteKeyMutation.mutate(provider)}
          />
        ))}
      </section>

      <section aria-label="Credits">
        <h2>Credits</h2>
        <CreditBalance balance={profile.creditBalance} />
      </section>

      <section aria-label="Appearance">
        <h2>Appearance</h2>
        <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
          Light
        </button>
        <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
          Dark
        </button>
      </section>

      <section aria-label="Account">
        <h2>Account</h2>
        <p>{profile.email}</p>
      </section>
    </div>
  );
}
