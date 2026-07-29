import type { ReactNode } from 'react';
import { MOVE_QUALITY_SYMBOLS, type MoveQuality } from '@chess-coach/shared';
import './MoveQualityBadge.css';

export interface MoveQualityBadgeProps {
  quality: MoveQuality | undefined;
  size: 'sm' | 'md';
}

/** Chess.com-style colored circle + glyph for a move's quality tier. Shared
 * by MoveExplorer (desktop, size="md") and MoveStrip (mobile, size="sm") so
 * the badge markup/styling exists in exactly one place. Renders nothing for
 * 'good' or undefined — those are intentionally badge-less (design spec
 * docs/superpowers/specs/2026-07-29-move-quality-badges-design.md). */
export function MoveQualityBadge({ quality, size }: MoveQualityBadgeProps): ReactNode {
  if (!quality || quality === 'good') return null;
  return (
    <span className={`move-quality-badge move-quality-badge--${size} move-quality-badge--${quality}`}>
      {MOVE_QUALITY_SYMBOLS[quality]}
    </span>
  );
}
