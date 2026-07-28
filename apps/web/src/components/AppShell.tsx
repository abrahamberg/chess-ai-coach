import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useIsDesktop } from '../hooks/useIsDesktop.js';
import './AppShell.css';

export interface AppShellProps {
  children: ReactNode;
}

/** design.md §3: bottom tab bar below the 1080px desktop breakpoint, a slim
 * icon rail at/above it. Purely presentational — navigation destinations are
 * wired to routes by the caller (App.tsx), not fetched or decided here. */
export function AppShell({ children }: AppShellProps): ReactNode {
  const isDesktop = useIsDesktop();

  return (
    <div className="app-shell" data-layout={isDesktop ? 'desktop' : 'mobile'}>
      {isDesktop ? <IconRail /> : <BottomTabBar />}
      <main className="app-shell__content">{children}</main>
    </div>
  );
}

const NAV_DESTINATIONS = [
  { to: '/games', label: 'Games' },
  { to: '/dashboard', label: 'Progress' },
  { to: '/settings', label: 'Settings' }
];

function BottomTabBar(): ReactNode {
  return (
    <nav className="bottom-tab-bar" aria-label="bottom tab bar">
      {NAV_DESTINATIONS.map((item) => (
        <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function IconRail(): ReactNode {
  return (
    <nav className="icon-rail" aria-label="icon rail">
      {NAV_DESTINATIONS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          title={item.label}
          className={({ isActive }) => (isActive ? 'active' : undefined)}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
