import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ArrowToken } from './ArrowToken.js';

describe('ArrowToken', () => {
  test('shows the from/to squares, read-only (no remove control)', () => {
    render(<ArrowToken from="e2" to="e4" />);
    expect(screen.getByText('e2')).toBeInTheDocument();
    expect(screen.getByText('e4')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
