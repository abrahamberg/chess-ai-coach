import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MoveCard } from './MoveCard.js';

describe('MoveCard', () => {
  test('renders the SAN the student played', () => {
    render(<MoveCard san="Nxd5" fen="startpos" />);
    expect(screen.getByText(/you played/i)).toBeInTheDocument();
    expect(screen.getByText('Nxd5')).toBeInTheDocument();
  });
});
