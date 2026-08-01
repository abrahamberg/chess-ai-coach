import type { ClassifiedMove } from '@chess-coach/chess-analysis';
import { isSoundQuality } from '@chess-coach/chess-analysis';
import { MOVE_QUALITY_SYMBOLS, type MoveQuality, type PositionAnalysis } from '@chess-coach/shared';
import { describeMoveRef } from './render.js';

/**
 * Coach context restructure design §5, layer 3: the whole game as annotated
 * SAN (chess.com/lichess quality-symbol convention). Static per game — this
 * block is byte-identical every turn of a session, so it rides its own
 * cache breakpoint. Only unsound moves (mistake/blunder/miss/dubious) get
 * extra detail inline, so an 80-ply game doesn't bloat the block.
 */
export function renderAnnotatedPgn(moves: ClassifiedMove[]): string {
  const body = moves.length === 0 ? '(no moves)' : moves.map(renderAnnotatedMove).join(' ');
  return `## This game (annotated)\n\n${body}`;
}

function renderAnnotatedMove(move: ClassifiedMove): string {
  const symbol = MOVE_QUALITY_SYMBOLS[move.quality];
  const base = `${movePrefix(move.ply)}${move.moveSan}${symbol}`;
  if (isSoundQuality(move.quality)) return base;
  const bestLine = move.bestLineSan[0] ? `, best ${move.bestLineSan[0]}` : '';
  return `${base} (lost ~${move.cpLoss}cp${bestLine})`;
}

/** "N." before White's move, nothing before Black's — matches how a human
 * reads annotated PGN out loud. */
function movePrefix(ply: number): string {
  return ply % 2 === 1 ? `${Math.ceil(ply / 2)}.` : '';
}

export interface MoveNoteEntry {
  ply: number;
  note: string;
}

export interface MoveQualityEntry {
  ply: number;
  quality: MoveQuality;
}

/**
 * Design §5, layer 4: one line per previously-discussed move outside the
 * one currently open, so the coach can refer back ("move 22 you missed
 * Rxd5") without the whole detour's raw conversation ever being replayed.
 * Rebuilt every turn from session_move_notes — cheap, and only its own
 * cache entry busts when a note actually changes.
 */
export function renderOtherMovesSummary(notes: MoveNoteEntry[], qualities: MoveQualityEntry[]): string {
  const qualityByPly = new Map(qualities.map((entry) => [entry.ply, entry.quality]));
  const body =
    notes.length === 0
      ? '(nothing discussed yet outside the current move)'
      : notes.map((entry) => renderOtherMoveLine(entry, qualityByPly)).join('\n');
  return `## Other moves discussed\n\n${body}`;
}

function renderOtherMoveLine(entry: MoveNoteEntry, qualityByPly: Map<number, MoveQuality>): string {
  const quality = qualityByPly.get(entry.ply);
  return `- ${describeMoveRef(entry.ply)}${quality ? ` (${quality})` : ''}: ${entry.note}`;
}

/**
 * Design §5, layer 5: the one part of the prompt that changes every turn —
 * rides after every cache breakpoint instead of busting one. `previousPly`
 * (null for a session's very first episode) states where the coach or
 * student arrived from, so the model never has to infer it from scrollback.
 * `threadsBlock` is the backstage conversation ledger (renderThreadsBlock's
 * output, render.ts) — folded in here rather than composed by the caller
 * (final review #8), so the '## Your thread ledger' heading stays prompt
 * text owned by packages/prompts, matching how this function already owns
 * its own '## Current position' heading.
 *
 * `fen` is the position actually on the student's board — since the board
 * now anchors one ply BEFORE a played move by default (universal default,
 * not gated behind showEngineAnalysis — see useSessionBoardState.ts), this
 * is the pre-move fen whenever `playedMove` is non-null, matching what's
 * shown with a red arrow client-side. `playedMove` (SAN, null only at the
 * game's start) names the move that was actually played, since the board no
 * longer shows the outcome directly. `analysis` is the opt-in raw engine
 * analysis of that same fen (showEngineAnalysis toggle) — omitted entirely
 * when the toggle is off, so the block is byte-for-byte what it always was
 * for every other student.
 */
export function renderCurrentMoveBlock(
  ply: number,
  fen: string,
  previousPly: number | null,
  threadsBlock: string,
  playedMove: string | null,
  analysis?: PositionAnalysis
): string {
  const arrival = previousPly !== null ? ` You reached this position from ${describeMoveRef(previousPly)}.` : '';
  const playedMoveSentence =
    playedMove !== null ? ` The move actually played here was ${playedMove} — shown as a red arrow on the board.` : '';
  const analysisBlock = analysis
    ? `\n\nFull engine analysis of this position (you may cite this directly — raw engine analysis is enabled for this student):\n\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``
    : '';
  return `## Current position\n\nYou are now discussing ${describeMoveRef(ply)} — this is what's actively on the board.${playedMoveSentence} FEN: ${fen}.${arrival}${analysisBlock}\n\n## Your thread ledger\n\n${threadsBlock}`;
}
