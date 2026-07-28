import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ByokKeyForm } from './ByokKeyForm.js';

describe('ByokKeyForm', () => {
  test('when saved, shows "saved ✓" and a delete button — never an input for the key', () => {
    render(<ByokKeyForm provider="anthropic" isSaved={true} onSave={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText(/saved/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('when not saved, shows an input and an add-key button', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<ByokKeyForm provider="openai" isSaved={false} onSave={onSave} onDelete={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: /api key/i }), 'sk-secret-value');
    await user.click(screen.getByRole('button', { name: /add key/i }));

    expect(onSave).toHaveBeenCalledWith('sk-secret-value');
  });

  test('clicking delete calls onDelete', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<ByokKeyForm provider="anthropic" isSaved={true} onSave={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
