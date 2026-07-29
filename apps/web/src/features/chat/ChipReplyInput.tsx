import type { DragEvent, ReactNode } from 'react';
import { ArrowChip } from './ArrowChip.js';
import { moveChip, removeChip, updateText, type DraftPart } from './composerDraft.js';

export interface ChipReplyInputProps {
  parts: DraftPart[];
  onChange: (parts: DraftPart[]) => void;
}

/** The reply composer: ordered text and drawn-arrow chips (design.md §5.7).
 * Chips are atomic and draggable, never editable as text — the student can
 * still type around them, e.g. "I think [e2-e4] is a good option". */
export function ChipReplyInput({ parts, onChange }: ChipReplyInputProps): ReactNode {
  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const chipId = event.dataTransfer.getData('text/plain');
    if (!chipId) return;
    const targetId = (event.target as HTMLElement).closest('[data-part-id]')?.getAttribute('data-part-id');
    const targetIndex = parts.findIndex((part) => part.id === targetId);
    if (targetIndex === -1) return;
    onChange(moveChip(parts, chipId, targetIndex));
  }

  return (
    <div className="chip-reply-input" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      {parts.map((part) =>
        part.type === 'arrow' ? (
          <span key={part.id} data-part-id={part.id}>
            <ArrowChip id={part.id} from={part.from} to={part.to} onRemove={() => onChange(removeChip(parts, part.id))} />
          </span>
        ) : (
          <input
            key={part.id}
            data-part-id={part.id}
            aria-label="Reply"
            value={part.value}
            onChange={(event) => onChange(updateText(parts, part.id, event.target.value))}
            placeholder="type a reply…"
          />
        )
      )}
    </div>
  );
}
