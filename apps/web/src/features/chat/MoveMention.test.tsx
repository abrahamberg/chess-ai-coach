import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { MoveMention } from './MoveMention.js';

describe('MoveMention', () => {
  test('renders bold text as <strong>', () => {
    render(<MoveMention text="b3" bold from="b2" to="b3" />);
    expect(screen.getByText('b3').tagName).toBe('STRONG');
  });

  test('renders non-bold text without <strong>', () => {
    render(<MoveMention text="b3" bold={false} from="b2" to="b3" />);
    expect(screen.getByText('b3').tagName).not.toBe('STRONG');
  });

  test('hovering calls onHover with the resolved from/to squares, un-hovering calls it with null', async () => {
    const onHover = vi.fn();
    const user = userEvent.setup();
    render(<MoveMention text="b3" bold={false} from="b2" to="b3" onHover={onHover} />);

    await user.hover(screen.getByText('b3'));
    expect(onHover).toHaveBeenCalledWith({ from: 'b2', to: 'b3' });

    await user.unhover(screen.getByText('b3'));
    expect(onHover).toHaveBeenCalledWith(null);
  });

  test('keyboard focus previews the move the same way hover does', async () => {
    const onHover = vi.fn();
    const user = userEvent.setup();
    render(<MoveMention text="b3" bold={false} from="b2" to="b3" onHover={onHover} />);

    await user.tab();
    expect(onHover).toHaveBeenCalledWith({ from: 'b2', to: 'b3' });

    await user.tab();
    expect(onHover).toHaveBeenCalledWith(null);
  });
});
