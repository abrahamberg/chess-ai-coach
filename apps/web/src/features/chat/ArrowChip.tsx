import type { DragEvent, ReactNode } from 'react';

export interface ArrowChipProps {
  id?: string;
  from: string;
  to: string;
  onRemove: () => void;
}

/** A drawn-arrow reference sitting inline in the reply composer — an atomic,
 * draggable object (not editable text) so the student can point at squares
 * and still say something around it, e.g. "I think [e2-e4] is a good
 * option" (design.md §5.7). */
export function ArrowChip({ id, from, to, onRemove }: ArrowChipProps): ReactNode {
  function handleDragStart(event: DragEvent<HTMLSpanElement>): void {
    event.dataTransfer.setData('text/plain', id ?? '');
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <span className="arrow-chip" data-testid="arrow-chip" draggable onDragStart={handleDragStart}>
      <code className="san">{from}</code>
      {'→'}
      <code className="san">{to}</code>
      <button type="button" aria-label={`remove arrow ${from} to ${to}`} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}
