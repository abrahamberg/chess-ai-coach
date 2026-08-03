export type MessageSegment =
  | { type: 'text'; value: string; bold: boolean }
  | { type: 'move'; text: string; san: string; bold: boolean; moveNumber?: number; color?: 'white' | 'black' };

const BOLD_PATTERN = /\*\*(.+?)\*\*/g;

const SAN_MOVE =
  'O-O-O[+#]?|O-O[+#]?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?';
// A leading move number written as "18.", "18...", or the coach's occasional
// "18-" typo — normalized to standard "18." / "18... " on display either way.
const MOVE_TOKEN = new RegExp(`\\b(\\d+)(\\.{1,3}|-)\\s*(${SAN_MOVE})\\b`, 'g');
const BARE_SAN = new RegExp(`\\b(${SAN_MOVE})\\b`, 'g');

/** Splits already-bold-stripped text on SAN move tokens (with or without a
 * leading move number) so the caller can render each as an interactive
 * reference instead of plain prose. */
function splitMoveTokens(text: string, bold: boolean): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MOVE_TOKEN)) {
    const index = match.index;
    if (index > lastIndex) segments.push(...splitBareMoves(text.slice(lastIndex, index), bold));
    const [full, number, separator, san] = match;
    const displaySeparator = separator === '-' ? '.' : separator;
    const displayText = `${number}${displaySeparator}${displaySeparator === '.' ? ' ' : ''}${san}`;
    const color: 'white' | 'black' = separator === '...' ? 'black' : 'white';
    segments.push({ type: 'move', text: displayText, san: san ?? '', bold, moveNumber: Number(number), color });
    lastIndex = index + (full?.length ?? 0);
  }
  if (lastIndex < text.length) segments.push(...splitBareMoves(text.slice(lastIndex), bold));

  return segments;
}

/** Finds bare SAN mentions ("Nf3", "b3") in text that has no move-number
 * prefix left to parse. */
function splitBareMoves(text: string, bold: boolean): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(BARE_SAN)) {
    const index = match.index;
    if (index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, index), bold });
    const san = match[1] ?? '';
    segments.push({ type: 'move', text: san, san, bold });
    lastIndex = index + (match[0]?.length ?? 0);
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex), bold });

  return segments;
}

/** Parses a coach/user message into text and move-mention segments, tracking
 * markdown `**bold**` spans so the renderer always shows real emphasis
 * instead of leaving literal asterisks in the transcript (the coach isn't
 * perfectly consistent about using them). */
export function parseMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(BOLD_PATTERN)) {
    const index = match.index;
    if (index > lastIndex) segments.push(...splitMoveTokens(text.slice(lastIndex, index), false));
    segments.push(...splitMoveTokens(match[1] ?? '', true));
    lastIndex = index + (match[0]?.length ?? 0);
  }
  if (lastIndex < text.length) segments.push(...splitMoveTokens(text.slice(lastIndex), false));

  return segments;
}
