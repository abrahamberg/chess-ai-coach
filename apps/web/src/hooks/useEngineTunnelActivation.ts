import { UserProfileSchema } from '@chess-coach/shared';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client.js';
import { useEngineTunnelClient } from './useEngineTunnelClient.js';

/** Keeps the browser-mode engine tunnel connected whenever the user has
 * engineMode 'browser' — mounted once at the app root (App.tsx) so
 * background jobs can reach the tab even outside an active session. Shares
 * SettingsPage's ['profile'] query, so this costs no extra fetch when
 * Settings is also open. */
export function useEngineTunnelActivation(): void {
  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: ({ signal }) => apiGet('/api/users/me', UserProfileSchema, signal)
  });

  useEngineTunnelClient({ enabled: profileQuery.data?.engineMode === 'browser' });
}
