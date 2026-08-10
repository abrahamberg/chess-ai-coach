import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ApiError } from '../../api/client.js';
import { ImportErrorNotice } from './ImportErrorNotice.js';

function problem(status: number, title: string): ApiError {
  return new ApiError(status, `failed with ${status}`, { type: 'about:blank', title, status });
}

describe('ImportErrorNotice', () => {
  test('a rate limit keeps the API wording and explains that waiting is the fix', () => {
    render(<ImportErrorNotice error={problem(429, 'Import limit reached (10 games/day)')} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Import limit reached (10 games/day)');
    expect(screen.getByRole('alert')).toHaveTextContent(/24-hour mark/i);
  });

  test('a rate limit is toned as a limit, not a failure', () => {
    const { container } = render(<ImportErrorNotice error={problem(429, 'Import limit reached (10 games/day)')} />);

    expect(container.querySelector('.import-error--limit')).not.toBeNull();
    expect(container.querySelector('.import-error--failure')).toBeNull();
  });

  // The parser's raw text names grammar productions, which tells the reader
  // nothing they can act on — the notice must not pass it through.
  test('an unparseable PGN is rewritten in plain language, not the parser grammar dump', () => {
    const parserText =
      'Invalid PGN: Expected brace comment, end of input, game termination marker, move number, standard algebraic notation, variation, or whitespace but "a" found.';

    render(<ImportErrorNotice error={problem(422, parserText)} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('That PGN couldn’t be read');
    expect(alert).not.toHaveTextContent(/Expected brace comment/);
    expect(alert).toHaveTextContent(/Download or PGN option/i);
  });

  test('an error with no problem+json title still says something useful', () => {
    render(<ImportErrorNotice error={new ApiError(500, 'boom')} />);

    expect(screen.getByRole('alert')).toHaveTextContent('That game couldn’t be imported');
  });
});
