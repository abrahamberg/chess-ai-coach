export interface ArrowRef {
  from: string;
  to: string;
}

const ARROW_TOKEN_PATTERN = /\[([a-h][1-8])-([a-h][1-8])\]/g;

/** The inline token a student's drawn-arrow chip serializes to inside a
 * plain-text chat message, e.g. "I think [e2-e4] is a good option". */
export function encodeArrowToken(arrow: ArrowRef): string {
  return `[${arrow.from}-${arrow.to}]`;
}

export type ArrowTextSegment = { type: 'text'; value: string } | ({ type: 'arrow' } & ArrowRef);

/** Splits message text on embedded arrow tokens so callers can render each
 * one as an inline badge instead of literal brackets. */
export function splitArrowTokens(text: string): ArrowTextSegment[] {
  const segments: ArrowTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(ARROW_TOKEN_PATTERN)) {
    const [full, from, to] = match;
    const index = match.index;
    if (index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, index) });
    segments.push({ type: 'arrow', from: from ?? '', to: to ?? '' });
    lastIndex = index + full.length;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) });

  return segments;
}
