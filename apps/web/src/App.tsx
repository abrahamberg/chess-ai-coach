import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';

const queryClient = new QueryClient();

export function App(): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/** Route table only — features/{import,games,session,dashboard,settings} fill
 * these in (Tasks 6.2-6.4); placeholders keep the shell buildable meanwhile. */
export function AppRoutes(): ReactNode {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/games" replace />} />
        <Route path="/import" element={<PlaceholderPage title="Import" />} />
        <Route path="/games" element={<PlaceholderPage title="Games" />} />
        <Route path="/session/:id" element={<PlaceholderPage title="Session" />} />
        <Route path="/dashboard" element={<PlaceholderPage title="Progress" />} />
        <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
      </Routes>
    </AppShell>
  );
}

function PlaceholderPage({ title }: { title: string }): ReactNode {
  return <h1>{title}</h1>;
}
