import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { LichessGamePicker } from './LichessGamePicker.js';

describe('LichessGamePicker', () => {
  test('renders a not-yet-available notice (backend arrives in Task 7.1)', () => {
    render(<LichessGamePicker />);

    expect(screen.getByText(/lichess/i)).toBeInTheDocument();
  });
});
