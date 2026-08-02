import { moveRefToPly } from '@chess-coach/chess-analysis';
import { describePly } from './positionDivider.js';

export interface DivergedMoveSan {
  san: string;
}

export interface DivergedLineState {
  basePly: number;
  baseFen: string;
  moves: { san: string; fen: string; uci: string }[];
}

/**
 * Standard PGN move-pair rendering continuing from an arbitrary basePly
 * (not always ply 0, unlike a game's annotated PGN) — "1.e4 e5 2.Nf3" from
 * the start, or "1...e5 2.Nf3" when the sequence's first move is black's
 * (basePly itself is a white move, i.e. odd).
 */
export function formatDivergedSanSequence(basePly: number, moves: DivergedMoveSan[]): string {
  return moves
    .map((move, index) => {
      const { moveNumber, color } = describePly(basePly + index + 1);
      if (color === 'white') return `${moveNumber}.${move.san}`;
      if (index === 0) return `${moveNumber}...${move.san}`;
      return move.san;
    })
    .join(' ');
}

const START_PREFIX = '[diverged_line_start]';
const LINE_PREFIX = '[diverged_line]';
const LINE_PATTERN =
  /^\[diverged_line\] Exploring from move (\d+) \((white|black)\): (.+) \(position now: ([^)]+)\): ([\s\S]*)$/;

export interface DivergedLineSan {
  basePly: number;
  sanMoves: string[];
  resultFen: string;
}

/** Client-synthesized announcement when hypothetical_line resolves —
 * assistant-authored, never re-sent to the coach — same JSON-after-prefix
 * pattern as encodeAnnotationNote. */
export function encodeDivergedLineStart(data: DivergedLineSan): string {
  return `${START_PREFIX}|${JSON.stringify(data)}`;
}

export function decodeDivergedLineStart(text: string): DivergedLineSan | null {
  if (!text.startsWith(`${START_PREFIX}|`)) return null;
  try {
    return JSON.parse(text.slice(START_PREFIX.length + 1)) as DivergedLineSan;
  } catch {
    return null;
  }
}

/** The student's submitted diverged line + optional commentary — becomes
 * the actual user turn sent to the coach, human-readable like [board_move]/
 * [position_context], e.g. "[diverged_line] Exploring from move 26 (white):
 * 26.a3 f6 27.a4 (position now: <fen>): <content>". */
export function encodeDivergedLine(line: DivergedLineState, content: string): string {
  const { moveNumber, color } = describePly(line.basePly + 1);
  const sanText = formatDivergedSanSequence(line.basePly, line.moves);
  const resultFen = line.moves.at(-1)?.fen ?? line.baseFen;
  return `${LINE_PREFIX} Exploring from move ${moveNumber} (${color}): ${sanText} (position now: ${resultFen}): ${content}`;
}

export function decodeDivergedLine(
  text: string
): { basePly: number; sanText: string; resultFen: string; content: string } | null {
  const match = LINE_PATTERN.exec(text);
  if (!match) return null;
  const [, moveNumber, color, sanText, resultFen, content] = match;
  const basePly = moveRefToPly(Number(moveNumber), color as 'white' | 'black') - 1;
  return { basePly, sanText: sanText ?? '', resultFen: resultFen ?? '', content: content ?? '' };
}
