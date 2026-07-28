import type { ReactNode } from 'react';
import { describeAnnotation, type AnnotationNoteState } from './positionDivider.js';

export type AnnotationNoteProps = AnnotationNoteState;

/** A persistent transcript entry for an annotate_board tool call — mirrors
 * PositionDivider's role for show_position, so drawn arrows/highlights don't
 * just flash and disappear (ToolActivity) but stay in the record. */
export function AnnotationNote({ arrows, highlights }: AnnotationNoteProps): ReactNode {
  return (
    <p className="annotation-note">
      ✏️ {describeAnnotation({ arrows, highlights })}
    </p>
  );
}
