import type { ClassifiedMove, FeatureDelta } from '@chess-coach/chess-analysis';
import { diffPositionFeatures, isSoundQuality } from '@chess-coach/chess-analysis';
import { MOVE_QUALITY_SYMBOLS, type MoveQuality, type PositionAnalysis, type PositionAnalysisLine } from '@chess-coach/shared';
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
 * Everything the curated "## Current position" analysis section needs,
 * gathered by the caller (apps/api/src/services/coach-context.ts) — this
 * module only renders, it never fetches or computes analysis itself.
 */
export interface CurrentMoveAnalysisContext {
  /** Engine analysis of the pre-move position (`fen` in renderCurrentMoveBlock) — supplies the best line and other engine options. */
  analysis: PositionAnalysis;
  /** This ply's classified-move entry, if the batch pipeline has reached it yet — supplies the cp-loss headline. Absent for a freshly-imported game the batch job hasn't classified yet. */
  classifiedMove?: ClassifiedMove;
  /** Engine analysis of the position AFTER the played move — supplies the "Played line" continuation. Omitted when the student played the engine's own best move (nothing to add) or when not fetched. */
  postMoveAnalysis?: PositionAnalysis;
  /** Diff between "after the engine's best move" and "after the move actually played" — omitted when there's no best move to compare against. */
  featureDelta?: FeatureDelta;
}

/** cp is white-perspective centipawns (services/engine/src/uci.ts normalizes
 * UCI's side-to-move-relative score before it ever reaches this layer),
 * matching ClassifiedMove.evalAfterCp's convention. */
function formatEval(cp: number | null, mateIn: number | null): string {
  if (mateIn !== null) return `mate in ${Math.abs(mateIn)}`;
  if (cp === null) return 'eval unknown';
  const pawns = (cp / 100).toFixed(2);
  return `eval ${cp >= 0 ? '+' : ''}${pawns}`;
}

/**
 * Renders a principal variation as standard interleaved PGN move text
 * ("8.d6 9.O-O a6 ..."), starting the numbering at `startPly` (the ply of
 * `sanMoves[0]`) so a line beginning on Black's move opens with "8...d5"
 * instead of a bare SAN. Truncated to `maxFullMoves` move-pairs so a deep
 * engine PV doesn't bloat the prompt — the cap only controls how much
 * context is spent, it isn't itself worth stating in the rendered text (the
 * model can already see how many moves are there).
 */
function formatPvLine(startPly: number, sanMoves: string[], maxFullMoves = 6): string {
  if (sanMoves.length === 0) return '';
  const truncated = sanMoves.slice(0, maxFullMoves * 2);
  return truncated
    .map((san, index) => {
      const movePly = startPly + index;
      const moveNumber = Math.ceil(movePly / 2);
      const isWhite = movePly % 2 === 1;
      if (isWhite) return `${moveNumber}.${san}`;
      return index === 0 ? `${moveNumber}...${san}` : san;
    })
    .join(' ');
}

function renderFeatureDeltaBullets(delta: FeatureDelta): string {
  const bullets: string[] = [];
  for (const fork of delta.newForks) {
    bullets.push(`- New fork: ${fork.piece} on ${fork.square} forks ${fork.forkedSquares.join('/')}`);
  }
  for (const piece of delta.newHangingPieces) {
    bullets.push(`- ${piece.color} ${piece.piece} on ${piece.square} is hanging`);
  }
  // A small swing (+/-1) happens on nearly every move and isn't worth a
  // callout — only surface a meaningful mobility change.
  if (delta.mobilityDelta <= -2) bullets.push(`- ${Math.abs(delta.mobilityDelta)} fewer legal replies available`);
  else if (delta.mobilityDelta >= 2) bullets.push(`- ${delta.mobilityDelta} more legal replies available`);
  return bullets.join('\n');
}

function findLineFor(lines: PositionAnalysisLine[], moveSan: string | null): PositionAnalysisLine | undefined {
  return moveSan === null ? undefined : lines.find((line) => line.moveSan === moveSan);
}

/**
 * Curated summary of the engine analysis — replaces the old raw-JSON dump
 * (design feedback: the model shouldn't have to parse/re-derive a delta the
 * server can compute once). `ply` is the played/candidate move's own ply
 * (renderCurrentMoveBlock's `ply` param), used to number PV lines correctly.
 */
function renderAnalysisSection(ply: number, playedMove: string | null, ctx: CurrentMoveAnalysisContext): string {
  const { analysis, classifiedMove, postMoveAnalysis, featureDelta } = ctx;
  const bestMove = analysis.bestMove;
  const bestLine = findLineFor(analysis.lines, bestMove);
  const parts: string[] = [];
  // `ply` is only the played/candidate move's own ply when a move was
  // actually played (playedMove !== null, so ply === input.currentPly, the
  // move under discussion). At the game start (playedMove === null, always
  // ply 0) the analyzed fen is the pre-move position for what would be ply
  // 1 (White's first move), so every line below has to be numbered from
  // there instead of from ply 0 itself.
  const linePly = playedMove === null ? ply + 1 : ply;

  if (playedMove === null) {
    if (bestMove && bestLine) {
      parts.push(`Engine's top choice here: ${bestMove} (${formatEval(bestLine.cp, bestLine.mateIn)})`);
      parts.push(`Line: ${formatPvLine(linePly, bestLine.pvSan)}`);
    }
  } else if (bestMove && playedMove === bestMove) {
    parts.push('This was the engine’s top choice.');
    if (bestLine) parts.push(`Line: ${formatPvLine(linePly, bestLine.pvSan)}`);
  } else if (bestMove && bestLine) {
    const playedEvalClause = classifiedMove
      ? ` (${formatEval(classifiedMove.evalAfterCp, null)}, cost ~${classifiedMove.cpLoss}cp)`
      : '';
    parts.push(
      `Played ${playedMove}${playedEvalClause} instead of the engine's best, ${bestMove} (${formatEval(bestLine.cp, bestLine.mateIn)}).`
    );
    parts.push(`Best line: ${formatPvLine(linePly, bestLine.pvSan)}`);
    const continuation = postMoveAnalysis?.lines[0]?.pvSan ?? [];
    parts.push(`Played line: ${formatPvLine(linePly, [playedMove, ...continuation])}`);
  }

  if (featureDelta) {
    const bullets = renderFeatureDeltaBullets(featureDelta);
    if (bullets) parts.push(`What changed vs. the best move:\n${bullets}`);
  }

  const otherLines = bestLine ? analysis.lines.filter((line) => line !== bestLine) : analysis.lines;
  if (otherLines.length > 0) {
    const otherText = otherLines
      .map((line) => `- ${line.moveSan} (${formatEval(line.cp, line.mateIn)}): ${formatPvLine(linePly, line.pvSan)}`)
      .join('\n');
    parts.push(`Other engine options:\n${otherText}`);
  }

  // The raw JSON below sits alongside the curated prose above rather than
  // replacing it — for the cases the curated summary can't anticipate
  // (investigating a non-obvious eval drop may need fields no bullet covers).
  // Both postMoveAnalysis and analysis are already-fetched, cached-by-fen
  // engine results (no extra engine round trip to produce this).
  if (postMoveAnalysis) {
    parts.push(`## Position full analyse\n\n${JSON.stringify(postMoveAnalysis, null, 2)}`);
    parts.push(
      `## Delta against best move\n\n${JSON.stringify(diffPositionFeatures(analysis.features, postMoveAnalysis.features), null, 2)}`
    );
  }

  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : '';
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
 * `fen` is the actual current position — the position reached AFTER
 * `playedMove` (not the pre-move position; the board's own pre-move-anchor/
 * red-arrow presentation is a client-side display choice that this text no
 * longer mirrors). `studentColor` is stated every turn (not just once in
 * the dynamic system block) because the model needs it right next to the
 * FEN to reason about it correctly. `playedMove` (SAN, null only at the
 * game's start) names the move that was actually played. `analysisContext`
 * is the curated engine-analysis summary of the pre-move position — always
 * supplied by the real caller (engine visibility is a universal default,
 * no per-student opt-in); optional here only so pure-render unit tests can
 * omit it.
 */
export function renderCurrentMoveBlock(
  ply: number,
  fen: string,
  studentColor: 'white' | 'black',
  threadsBlock: string,
  playedMove: string | null,
  analysisContext?: CurrentMoveAnalysisContext
): string {
  const playedMoveSentence = playedMove !== null ? ` The move actually played here was ${playedMove}.` : '';
  const analysisBlock = analysisContext ? renderAnalysisSection(ply, playedMove, analysisContext) : '';
  return `## Current position\n\nYou are now discussing ${describeMoveRef(ply)} — this is what's actively on the board. Your student is playing ${studentColor} in this game.${playedMoveSentence} FEN : ${fen}.${analysisBlock}\n\n## Your thread ledger\n\n${threadsBlock}`;
}
