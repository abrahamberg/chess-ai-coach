import { useEffect, useState } from 'react';

/** design.md §3.1 — desktop breakpoint (icon rail vs bottom tab bar). */
export const DESKTOP_BREAKPOINT_QUERY = '(min-width: 1080px)';

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(DESKTOP_BREAKPOINT_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, []);

  return isDesktop;
}
