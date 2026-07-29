import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ChipReplyInput } from './ChipReplyInput.js';
import type { DraftPart } from './composerDraft.js';

describe('ChipReplyInput', () => {
  test('typing into a lone text part calls onChange with the updated value', async () => {
    const onChange = vi.fn();
    const parts: DraftPart[] = [{ id: 'a', type: 'text', value: '' }];
    render(<ChipReplyInput parts={parts} onChange={onChange} />);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: /reply/i }), 'x');

    expect(onChange).toHaveBeenCalledWith([{ id: 'a', type: 'text', value: 'x' }]);
  });

  test('renders an arrow chip inline, with the surrounding text parts as separate inputs', () => {
    const parts: DraftPart[] = [
      { id: 'a', type: 'text', value: 'I think ' },
      { id: 'b', type: 'arrow', from: 'e2', to: 'e4' },
      { id: 'c', type: 'text', value: ' is good' }
    ];
    render(<ChipReplyInput parts={parts} onChange={vi.fn()} />);

    expect(screen.getByTestId('arrow-chip')).toBeInTheDocument();
    expect(screen.getByDisplayValue('I think', { exact: false })).toBeInTheDocument();
    expect(screen.getByDisplayValue('is good', { exact: false })).toBeInTheDocument();
  });

  test('removing a chip calls onChange with it gone', () => {
    const onChange = vi.fn();
    const parts: DraftPart[] = [
      { id: 'a', type: 'text', value: 'before ' },
      { id: 'b', type: 'arrow', from: 'e2', to: 'e4' },
      { id: 'c', type: 'text', value: ' after' }
    ];
    render(<ChipReplyInput parts={parts} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onChange).toHaveBeenCalledWith([{ id: 'a', type: 'text', value: 'before  after' }]);
  });

  test('dropping a chip onto another part reorders it', () => {
    const onChange = vi.fn();
    const parts: DraftPart[] = [
      { id: 'a', type: 'arrow', from: 'e2', to: 'e4' },
      { id: 'b', type: 'text', value: 'x' }
    ];
    render(<ChipReplyInput parts={parts} onChange={onChange} />);

    const dataTransfer = { getData: () => 'a' };
    fireEvent.drop(screen.getByDisplayValue('x'), { dataTransfer });

    expect(onChange).toHaveBeenCalledWith([{ id: 'b', type: 'text', value: 'x' }, parts[0]]);
  });
});
