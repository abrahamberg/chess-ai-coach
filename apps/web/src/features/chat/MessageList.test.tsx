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

  test('does not call onScrollUp while at the bottom', () => {
    const onScrollUp = vi.fn();
    render(<MessageList messages={[msg('1', 'hi')]} onScrollUp={onScrollUp} />);
    const container = screen.getByTestId('message-list');

    setScrollGeometry(container, { scrollTop: 100, scrollHeight: 120, clientHeight: 20 });
    fireEvent.scroll(container);

    expect(onScrollUp).not.toHaveBeenCalled();
  });
});
