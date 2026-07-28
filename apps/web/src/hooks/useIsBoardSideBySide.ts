import { useEffect, useState } from 'react';

/** design.md §3.1 — session-screen layout breakpoint: mobile (<768px) stacks
 * board-over-chat; tablet AND desktop (>=768px) both go side-by-side. This is
 * deliberately a different threshold from useIsDesktop's 1080px nav
 * breakpoint (icon rail vs. bottom tab bar) — tablet gets the desktop-style
 * split layout but still gets the bottom tab bar for navigation. */
export const BOARD_SIDE_BY_SIDE_QUERY = '(min-width: 768px)';

export function useIsBoardSideBySide(): boolean {
  const [isSideBySide, setIsSideBySide] = useState(() => window.matchMedia(BOARD_SIDE_BY_SIDE_QUERY).matches);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(BOARD_SIDE_BY_SIDE_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsSideBySide(event.matches);
    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, []);

  return isSideBySide;
}
