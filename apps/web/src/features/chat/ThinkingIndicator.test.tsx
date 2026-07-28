import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ThinkingIndicator } from './ThinkingIndicator.js';

describe('ThinkingIndicator (design.md §5.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders nothing when not thinking', () => {
    render(<ThinkingIndicator visible={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('does not appear immediately (avoids flicker on fast replies)', () => {
    render(<ThinkingIndicator visible={true} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('appears after a 300ms delay', () => {
    render(<ThinkingIndicator visible={true} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('status', { name: /coach is thinking/i })).toBeInTheDocument();
  });

  test('disappears immediately once no longer visible', () => {
    const { rerender } = render(<ThinkingIndicator visible={true} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<ThinkingIndicator visible={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
