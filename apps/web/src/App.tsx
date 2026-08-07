import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { GamesPage } from './features/games/GamesPage.js';
import { ImportPage } from './features/import/ImportPage.js';
import { PlayStartPage } from './features/play/PlayStartPage.js';
import { SessionPage } from './features/session/SessionPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';

const queryClient = new QueryClient();

/** Resetting a session (see SessionHeader) navigates from /session/:oldId to
 * /session/:newId without a route change, so React Router reuses the same
 * SessionPage instance — its per-session refs/hooks (e.g. the kickoff-once
 * ref) would otherwise carry over stale state. Keying by :id forces a clean
 * remount whenever the session actually changes. */
function SessionRoute(): ReactNode {
  const { id } = useParams<{ id: string }>();
  return <SessionPage key={id} />;
}

export function App(): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export function AppRoutes(): ReactNode {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/games" replace />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/play/new" element={<PlayStartPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/session/:id" element={<SessionRoute />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppShell>
  );
}
