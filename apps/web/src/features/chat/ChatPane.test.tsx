import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ChatPane } from './ChatPane.js';

describe('ChatPane', () => {
  test('sends the input text and clears it', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPane sessionId="test-session" messages={[]} activeToolName={null} onSend={onSend} />);

    await user.type(screen.getByRole('textbox', { name: /reply/i }), 'hello coach');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('hello coach');
    expect(screen.getByRole('textbox', { name: /reply/i })).toHaveValue('');
  });

  test('does not send an empty message', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPane sessionId="test-session" messages={[]} activeToolName={null} onSend={onSend} />);

    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
  });

  test('allows an empty-text send when a diverged line is pending', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPane sessionId="test-session" messages={[]} activeToolName={null} onSend={onSend} hasPendingLine />);

    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('');
  });

  test('forwards onSelectPly through to MessageList', () => {
    const onSelectPly = vi.fn();
    render(
      <ChatPane
        sessionId="test-session"
        messages={[{ id: '1', role: 'assistant', text: '[position_divider]|14|Bg4' }]}
        activeToolName={null}
        onSend={vi.fn()}
        onSelectPly={onSelectPly}
      />
    );

    screen.getByRole('button', { name: /move 7/i }).click();

    expect(onSelectPly).toHaveBeenCalledWith(14);
  });

  test('forwards fen and onHoverMove through to MessageList so it can resolve move mentions', async () => {
    const onHoverMove = vi.fn();
    const user = userEvent.setup();
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    render(
      <ChatPane
        sessionId="test-session"
        messages={[{ id: '1', role: 'assistant', text: 'what about b3 here?' }]}
        activeToolName={null}
        onSend={vi.fn()}
        fen={fen}
        onHoverMove={onHoverMove}
      />
    );

    await user.hover(screen.getByText('b3'));

    expect(onHoverMove).toHaveBeenCalledWith({ from: 'b2', to: 'b3' });
  });

  test('shows tool activity for a visible tool', () => {
    render(<ChatPane sessionId="test-session" messages={[]} activeToolName="get_engine_analysis" onSend={vi.fn()} />);
    expect(screen.getByText(/checking a line/i)).toBeInTheDocument();
  });

  test('design.md §5.7: a board-drawn arrow appears as a chip in the reply box, and sending it includes the bracketed token', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ChatPane sessionId="test-session" messages={[]} activeToolName={null} onSend={onSend} boardArrows={[]} />);

    rerender(
      <ChatPane sessionId="test-session" messages={[]} activeToolName={null} onSend={onSend} boardArrows={[{ from: 'e2', to: 'e4' }]} />
    );

    expect(screen.getByTestId('arrow-chip')).toBeInTheDocument();

    await user.type(screen.getAllByRole('textbox', { name: /reply/i }).at(-1) as HTMLElement, 'looks strong');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('[e2-e4]looks strong');
  });

  test('erasing a drawn arrow (board reports it gone) removes its chip from the reply box', () => {
    const { rerender } = render(
      <ChatPane
        sessionId="test-session"
        messages={[]}
        activeToolName={null}
        onSend={vi.fn()}
        boardArrows={[{ from: 'e2', to: 'e4' }]}
      />
    );
    expect(screen.getByTestId('arrow-chip')).toBeInTheDocument();

    rerender(<ChatPane sessionId="test-session" messages={[]} activeToolName={null} onSend={vi.fn()} boardArrows={[]} />);

    expect(screen.queryByTestId('arrow-chip')).not.toBeInTheDocument();
  });

  test('the debug trigger is disabled until an assistant turn has completed', () => {
    const { rerender } = render(<ChatPane sessionId="test-session" messages={[]} activeToolName={null} onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: /debug last answer/i })).toBeDisabled();

    rerender(
      <ChatPane
        sessionId="test-session"
        messages={[{ id: '1', role: 'assistant', text: 'Hi there!' }]}
        activeToolName={null}
        onSend={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /debug last answer/i })).toBeEnabled();
  });

  test('an empty streaming-placeholder assistant message does not count as a completed turn', () => {
    render(
      <ChatPane
        sessionId="test-session"
        messages={[{ id: '1', role: 'assistant', text: '' }]}
        activeToolName={null}
        onSend={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /debug last answer/i })).toBeDisabled();
  });

  test('clicking the debug trigger opens the debug panel, which fetches the last-turn snapshot', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ notReady: true }), { status: 404 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ChatPane
        sessionId="test-session"
        messages={[{ id: '1', role: 'assistant', text: 'Hi there!' }]}
        activeToolName={null}
        onSend={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /debug last answer/i }));

    expect(screen.getByRole('dialog', { name: /coach turn debug/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/test-session/debug/last-turn', expect.anything());

    vi.unstubAllGlobals();
  });
});
