import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CoachMessage } from '../../hooks/useCoachChat.js';
import { MessageList } from './MessageList.js';

function msg(id: string, text: string): CoachMessage {
  return { id, role: 'assistant', text };
}

function setScrollGeometry(el: HTMLElement, { scrollTop, scrollHeight, clientHeight }: Record<string, number>) {
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

describe('MessageList', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('auto-scrolls to the bottom when a new message arrives while at the bottom', () => {
    const { rerender } = render(<MessageList messages={[msg('1', 'hi')]} />);
    const container = screen.getByTestId('message-list');
    setScrollGeometry(container, { scrollTop: 100, scrollHeight: 120, clientHeight: 20 }); // at bottom
    fireEvent.scroll(container);

    rerender(<MessageList messages={[msg('1', 'hi'), msg('2', 'more')]} />);

    expect(container.scrollTo).toHaveBeenCalled();
  });

  test('suppresses auto-scroll when the user has scrolled up', () => {
    const { rerender } = render(<MessageList messages={[msg('1', 'hi')]} />);
    const container = screen.getByTestId('message-list');
    setScrollGeometry(container, { scrollTop: 0, scrollHeight: 500, clientHeight: 20 }); // scrolled way up
    fireEvent.scroll(container);
    vi.mocked(container.scrollTo).mockClear(); // ignore the initial-mount scroll-to-bottom

    rerender(<MessageList messages={[msg('1', 'hi'), msg('2', 'more')]} />);

    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  test('calls onScrollUp when the user scrolls away from the bottom', () => {
    const onScrollUp = vi.fn();
    render(<MessageList messages={[msg('1', 'hi')]} onScrollUp={onScrollUp} />);
    const container = screen.getByTestId('message-list');

    setScrollGeometry(container, { scrollTop: 0, scrollHeight: 500, clientHeight: 20 });
    fireEvent.scroll(container);

    expect(onScrollUp).toHaveBeenCalledOnce();
  });

  test('design.md §5.3: renders a [board_move] message as a compact move card, not raw plumbing text', () => {
    render(
      <MessageList
        messages={[
          {
            id: '1',
            role: 'user',
            text: '[board_move] I played Nf3 (position now: rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1)'
          }
        ]}
      />
    );

    expect(screen.getByText(/you played/i)).toBeInTheDocument();
    expect(screen.getByText('Nf3')).toBeInTheDocument();
    expect(screen.queryByText(/\[board_move\]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/position now/i)).not.toBeInTheDocument();
  });

  test('design.md §5.3: renders a position-divider sentinel as "— move N, after SAN —"', () => {
    render(<MessageList messages={[{ id: '1', role: 'assistant', text: '[position_divider]|14|Bg4' }]} />);

    expect(screen.getByText(/move 14/)).toBeInTheDocument();
    expect(screen.getByText('Bg4')).toBeInTheDocument();
  });

  test('does not call onScrollUp while at the bottom', () => {
    const onScrollUp = vi.fn();
    render(<MessageList messages={[msg('1', 'hi')]} onScrollUp={onScrollUp} />);
    const container = screen.getByTestId('message-list');

    setScrollGeometry(container, { scrollTop: 100, scrollHeight: 120, clientHeight: 20 });
    fireEvent.scroll(container);

    expect(onScrollUp).not.toHaveBeenCalled();
  });
});
