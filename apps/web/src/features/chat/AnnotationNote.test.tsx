import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { AnnotationNote } from './AnnotationNote.js';

describe('AnnotationNote', () => {
  test('renders a persistent note describing what the coach drew', () => {
    render(<AnnotationNote arrows={[{ from: 'e2', to: 'e4', color: '#c9762a' }]} highlights={[]} />);
    expect(screen.getByText(/e2→e4/)).toBeInTheDocument();
  });

  test('mentions highlighted squares too', () => {
    render(<AnnotationNote arrows={[]} highlights={[{ square: 'd5', color: '#4a7fb5' }]} />);
    expect(screen.getByText(/highlighted d5/)).toBeInTheDocument();
  });
});
