import type { ReactNode } from 'react';

export interface MoveMentionProps {
  /** The text as it should display, e.g. "b3" or "1. e3" (already normalized
   * by moveMention.ts's parser). */
  text: string;
  bold: boolean;
  from: string;
  to: string;
  onHover?: (move: { from: string; to: string } | null) => void;
}

/** A move the coach mentioned in prose, resolved against the currently
 * displayed position — hovering (or focusing, for keyboard users) previews
 * it on the board via onHover, distinct from the coach's own annotate_board
 * arrows (design.md §5.3/§5.4). */
export function MoveMention({ text, bold, from, to, onHover }: MoveMentionProps): ReactNode {
  const content = bold ? <strong>{text}</strong> : text;
  return (
    <span
      className="move-mention"
      tabIndex={0}
      onMouseEnter={() => onHover?.({ from, to })}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.({ from, to })}
      onBlur={() => onHover?.(null)}
    >
      {content}
    </span>
  );
}
