import type { ArrowRef } from './arrowToken.js';
import { encodeArrowToken } from './arrowToken.js';

export type DraftPart =
  | { id: string; type: 'text'; value: string }
  | ({ id: string; type: 'arrow' } & ArrowRef);

function newId(): string {
  return crypto.randomUUID();
}

function textPart(value = ''): DraftPart {
  return { id: newId(), type: 'text', value };
}

export function createEmptyDraft(): DraftPart[] {
  return [textPart()];
}

export function isDraftEmpty(parts: DraftPart[]): boolean {
  return !parts.some((part) => (part.type === 'arrow' ? true : part.value.trim() !== ''));
}

export function serializeDraft(parts: DraftPart[]): string {
  return parts.map((part) => (part.type === 'text' ? part.value : encodeArrowToken(part))).join('');
}

function arrowKey(arrow: ArrowRef): string {
  return `${arrow.from}-${arrow.to}`;
}

/**
 * Syncs the composer's chips to the board's currently-drawn arrows (diffing
 * against the previous set): a newly-drawn arrow is appended as a chip, and
 * an arrow no longer on the board (erased by hand, or auto-cleared on the
 * next show_position) has its chip removed — the same board state drives
 * both directions.
 */
export function reconcileArrowChips(parts: DraftPart[], prevArrows: ArrowRef[], nextArrows: ArrowRef[]): DraftPart[] {
  const prevKeys = new Set(prevArrows.map(arrowKey));
  const nextKeys = new Set(nextArrows.map(arrowKey));

  const added = nextArrows.filter((arrow) => !prevKeys.has(arrowKey(arrow)));
  const removedKeys = new Set(prevArrows.filter((arrow) => !nextKeys.has(arrowKey(arrow))).map(arrowKey));

  let result = parts.filter((part) => part.type !== 'arrow' || !removedKeys.has(arrowKey(part)));

  for (const arrow of added) {
    result = [...result, { id: newId(), type: 'arrow', ...arrow }, textPart()];
  }

  return result;
}

/** Updates the value of the text part with the given id. */
export function updateText(parts: DraftPart[], id: string, value: string): DraftPart[] {
  return parts.map((part) => (part.id === id && part.type === 'text' ? { ...part, value } : part));
}

/** Removes one chip (its own × button) and merges the text parts left on
 * either side of it, so typing continues to flow as a single segment. */
export function removeChip(parts: DraftPart[], id: string): DraftPart[] {
  const index = parts.findIndex((part) => part.id === id);
  if (index === -1) return parts;

  const before = parts[index - 1];
  const after = parts[index + 1];
  if (before?.type === 'text' && after?.type === 'text') {
    const merged: DraftPart = { ...before, value: before.value + after.value };
    return [...parts.slice(0, index - 1), merged, ...parts.slice(index + 2)];
  }

  return [...parts.slice(0, index), ...parts.slice(index + 1)];
}

/** Drag-reorders a chip to sit just before the part currently at
 * `targetIndex` (computed against the array with the chip removed). */
export function moveChip(parts: DraftPart[], id: string, targetIndex: number): DraftPart[] {
  const chip = parts.find((part) => part.id === id);
  if (!chip) return parts;

  const withoutChip = parts.filter((part) => part.id !== id);
  return [...withoutChip.slice(0, targetIndex), chip, ...withoutChip.slice(targetIndex)];
}
