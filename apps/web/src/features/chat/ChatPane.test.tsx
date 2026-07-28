import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ChatPane } from './ChatPane.js';

describe('ChatPane', () => {
  test('forwards MessageList scroll-up to onScrollUp', () => {
    const onScrollUp = vi.fn();
    render(<ChatPane messages={[]} activeToolName={null} onSend={vi.fn()} onScrollUp={onScrollUp} />);

    const container = screen.getByTestId('message-list');
    Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 20, configurable: true });
    fireEvent.scroll(container);

    expect(onScrollUp).toHaveBeenCalledOnce();
  });

  test('sends the input text and clears it', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPane messages={[]} activeToolName={null} onSend={onSend} />);

    await user.type(screen.getByRole('textbox', { name: /reply/i }), 'hello coach');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('hello coach');
    expect(screen.getByRole('textbox', { name: /reply/i })).toHaveValue('');
  });

  test('does not send an empty message', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPane messages={[]} activeToolName={null} onSend={onSend} />);

    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
  });

  test('shows tool activity for a visible tool', () => {
    render(<ChatPane messages={[]} activeToolName="get_engine_analysis" onSend={vi.fn()} />);
    expect(screen.getByText(/checking a line/i)).toBeInTheDocument();
  });
});
