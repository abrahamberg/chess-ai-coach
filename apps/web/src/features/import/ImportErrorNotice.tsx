import type { ReactNode } from 'react';
import { ApiError } from '../../api/client.js';
import './ImportErrorNotice.css';

const RATE_LIMITED = 429;

export interface ImportErrorNoticeProps {
  /** The failed import mutation's error. Callers must not pass the 422
   * missing-userColor case — ColorConfirm answers that one instead. */
  error: unknown;
}

/** The API's problem+json bodies carry a human-readable `title` (e.g. "Import
 * limit reached (10 games/day)") — far more useful to show than a status code. */
function problemTitle(error: unknown): string | null {
  const title = error instanceof ApiError ? (error.body as { title?: string } | undefined)?.title : null;
  return typeof title === 'string' && title.length > 0 ? title : null;
}

/** Two tones, because the two failures need different things from the reader:
 * a rate limit is a wait (nothing is wrong, and retrying now won't help), a
 * failure is a fix (something about this request needs to change). The left
 * rule colour carries that distinction using the same palette the move-quality
 * badges use, so it reads the same way everywhere in the app. */
function describe(error: unknown): { tone: 'limit' | 'failure'; title: string; hint: string } {
  const title = problemTitle(error);

  if (error instanceof ApiError && error.status === RATE_LIMITED) {
    return {
      tone: 'limit',
      title: title ?? 'Import limit reached',
      hint: 'The cap rolls over continuously — you can import again once one of your recent games passes the 24-hour mark.'
    };
  }

  // packages/chess-analysis's InvalidPgnError forwards the PEG parser's own
  // failure text ("Expected brace comment, end of input, game termination
  // marker, …"), which describes the grammar rather than anything the reader
  // can act on. Keep that detail in the API response for debugging and say
  // something usable here instead.
  if (title?.startsWith('Invalid PGN')) {
    return {
      tone: 'failure',
      title: 'That PGN couldn’t be read',
      hint: 'Paste the whole game, including the move list. On Chess.com or Lichess, the game’s Download or PGN option gives you the right text.'
    };
  }

  return {
    tone: 'failure',
    title: title ?? 'That game couldn’t be imported',
    hint: 'Check the PGN is complete, then import it again.'
  };
}

/** design.md §4.2: an import can fail for reasons the reader can act on, so it
 * gets a real notice above the form rather than a silent no-op on the button. */
export function ImportErrorNotice({ error }: ImportErrorNoticeProps): ReactNode {
  const { tone, title, hint } = describe(error);

  return (
    <div role="alert" className={`import-error import-error--${tone}`}>
      <p className="import-error__title">{title}</p>
      <p className="import-error__hint">{hint}</p>
    </div>
  );
}
