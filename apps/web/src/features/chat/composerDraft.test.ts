import { describe, expect, test } from 'vitest';
import {
  createEmptyDraft,
  isDraftEmpty,
  moveChip,
  reconcileArrowChips,
  removeChip,
  updateText,
  serializeDraft,
  type DraftPart
} from './composerDraft.js';

describe('createEmptyDraft / isDraftEmpty', () => {
  test('starts as a single empty text part, and is empty', () => {
    const draft = createEmptyDraft();
    expect(draft).toEqual([{ id: expect.any(String), type: 'text', value: '' }]);
    expect(isDraftEmpty(draft)).toBe(true);
  });

  test('a draft with only whitespace text is still empty', () => {
    const draft: DraftPart[] = [{ id: '1', type: 'text', value: '   ' }];
    expect(isDraftEmpty(draft)).toBe(true);
  });

  test('a draft with a chip, even with no text, is not empty', () => {
    const draft: DraftPart[] = [{ id: '1', type: 'arrow', from: 'e2', to: 'e4' }];
    expect(isDraftEmpty(draft)).toBe(false);
  });
});

describe('serializeDraft', () => {
  test('joins text parts as-is', () => {
    const draft: DraftPart[] = [{ id: '1', type: 'text', value: 'hello coach' }];
    expect(serializeDraft(draft)).toBe('hello coach');
  });

  test('renders an arrow chip as its bracketed token, inline with surrounding text', () => {
    const draft: DraftPart[] = [
      { id: '1', type: 'text', value: 'I think ' },
      { id: '2', type: 'arrow', from: 'e2', to: 'e4' },
      { id: '3', type: 'text', value: ' is a good option' }
    ];
    expect(serializeDraft(draft)).toBe('I think [e2-e4] is a good option');
  });
});

describe('reconcileArrowChips', () => {
  test('a newly-drawn arrow is appended as a chip, followed by a fresh empty text part', () => {
    const draft = createEmptyDraft();
    const next = reconcileArrowChips(draft, [], [{ from: 'e2', to: 'e4' }]);

    expect(next).toEqual([
      draft[0],
      { id: expect.any(String), type: 'arrow', from: 'e2', to: 'e4' },
      { id: expect.any(String), type: 'text', value: '' }
    ]);
  });

  test('erasing a drawn arrow (right-click again, or auto-clear on position change) removes its chip', () => {
    const drawn = reconcileArrowChips(createEmptyDraft(), [], [{ from: 'e2', to: 'e4' }]);
    const erased = reconcileArrowChips(drawn, [{ from: 'e2', to: 'e4' }], []);

    expect(erased.some((part) => part.type === 'arrow')).toBe(false);
  });

  test('an unrelated text edit between reconciles is preserved', () => {
    const drawn = reconcileArrowChips(createEmptyDraft(), [], [{ from: 'e2', to: 'e4' }]);
    const withTyping = drawn.map((part) => (part.type === 'text' ? { ...part, value: 'looks strong' } : part));
    const stillHasTyping = reconcileArrowChips(withTyping, [{ from: 'e2', to: 'e4' }], [{ from: 'e2', to: 'e4' }]);

    expect(stillHasTyping).toEqual(withTyping);
  });
});

describe('removeChip', () => {
  test('removes the chip with the given id and merges its neighboring text parts', () => {
    const draft: DraftPart[] = [
      { id: 'a', type: 'text', value: 'before ' },
      { id: 'b', type: 'arrow', from: 'e2', to: 'e4' },
      { id: 'c', type: 'text', value: ' after' }
    ];

    expect(removeChip(draft, 'b')).toEqual([{ id: 'a', type: 'text', value: 'before  after' }]);
  });
});

describe('moveChip', () => {
  test('reorders a chip to sit after a later part', () => {
    const draft: DraftPart[] = [
      { id: 'a', type: 'arrow', from: 'e2', to: 'e4' },
      { id: 'b', type: 'text', value: 'x' },
      { id: 'c', type: 'arrow', from: 'd2', to: 'd4' }
    ];

    expect(moveChip(draft, 'a', 2)).toEqual([
      { id: 'b', type: 'text', value: 'x' },
      { id: 'c', type: 'arrow', from: 'd2', to: 'd4' },
      { id: 'a', type: 'arrow', from: 'e2', to: 'e4' }
    ]);
  });
});

describe('updateText', () => {
  test('updates the value of the text part with the given id, leaving other parts untouched', () => {
    const draft: DraftPart[] = [
      { id: 'a', type: 'text', value: '' },
      { id: 'b', type: 'arrow', from: 'e2', to: 'e4' }
    ];

    expect(updateText(draft, 'a', 'hello')).toEqual([
      { id: 'a', type: 'text', value: 'hello' },
      { id: 'b', type: 'arrow', from: 'e2', to: 'e4' }
    ]);
  });
});
