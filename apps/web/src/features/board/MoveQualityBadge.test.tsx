import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MoveQualityBadge } from './MoveQualityBadge.js';

describe('MoveQualityBadge', () => {
  test('renders nothing for a good move', () => {
    const { container } = render(<MoveQualityBadge quality="good" size="md" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when quality is undefined', () => {
    const { container } = render(<MoveQualityBadge quality={undefined} size="md" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders the star glyph for best, sized md', () => {
    render(<MoveQualityBadge quality="best" size="md" />);
    const badge = screen.getByText('★');
    expect(badge).toHaveClass('move-quality-badge--best');
    expect(badge).toHaveClass('move-quality-badge--md');
  });

  test('renders the X glyph for miss, sized sm', () => {
    render(<MoveQualityBadge quality="miss" size="sm" />);
    const badge = screen.getByText('✕');
    expect(badge).toHaveClass('move-quality-badge--miss');
    expect(badge).toHaveClass('move-quality-badge--sm');
  });

  test('renders the double-exclamation glyph for brilliant', () => {
    render(<MoveQualityBadge quality="brilliant" size="md" />);
    expect(screen.getByText('!!')).toHaveClass('move-quality-badge--brilliant');
  });
});
