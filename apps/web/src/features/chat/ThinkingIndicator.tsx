import { useEffect, useState, type ReactNode } from 'react';

export interface ThinkingIndicatorProps {
  visible: boolean;
}

const APPEAR_DELAY_MS = 300;

/** design.md §5.7: a 3-dot typing indicator in a coach bubble, appearing
 * after a 300ms delay so a fast reply never flickers it on and off. */
export function ThinkingIndicator({ visible }: ThinkingIndicatorProps): ReactNode {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const timeout = setTimeout(() => setShown(true), APPEAR_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [visible]);

  if (!shown) return null;

  return (
    <p className="thinking-indicator" aria-label="the coach is thinking" role="status">
      <span />
      <span />
      <span />
    </p>
  );
}
