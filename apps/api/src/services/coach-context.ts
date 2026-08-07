import { cachedSystemMessage, systemMessage, type ChatMessage, type SystemChatMessage } from '../llm/messages.js';
import {
  applySanSequence,
  computePositionFeatures,
  diffPositionFeatures,
  moveRefToPly,
  type FeatureDelta
} from '@chess-coach/chess-analysis';
import {
  renderAnnotatedPgn,
  renderCurrentMoveBlock,
  renderGameSoFarInline,
  renderOtherMovesSummary,
  renderThreadsBlock,
  type AnnotatedMoveLike
} from '@chess-coach/prompts';
import type { PositionAnalysis } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gameMoveQualitiesRepo from '../db/repositories/game-move-qualities.js';
import type { SessionMessageRow } from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import { currentEpisode } from '../lib/episodes.js';
import { getPositionAtPly } from './game-positions.js';
import { includeOrphanedToolCall } from './coach-context-orphan-boundary.js';
import { resolveEpisodeReplay, type CoachContextDependencies } from './coach-context-replay.js';

export { closeEpisodeIfNeeded } from './coach-context-episode-close.js';
export type { CoachContextDependencies } from './coach-context-replay.js';

const POSITION_CONTEXT_PATTERN = /^\[position_context\] Back at move (\d+) \((white|black)\),/;

/**
 * Server-side counterpart of apps/web's encodePositionContext (design doc
 * §2) — "never trust the client": the claimed ply is re-derived from the
 * game's real move list via getPositionAtPly, exactly like show_position's
 * result already is, never taken on faith from the sentinel text.
 */
export async function resolvePositionContextJump(
  db: Kysely<Database>,
  gameId: string,
  content: string
): Promise<{ ply: number } | null> {
  const match = POSITION_CONTEXT_PATTERN.exec(content);
  if (!match?.[1] || !match[2]) return null;
  const ply = moveRefToPly(Number(match[1]), match[2] as 'white' | 'black');
  const position = await getPositionAtPly(db, gameId, ply);
  return position ? { ply } : null;
}

export interface EpisodeLayers {
  staticPart: string;
  dynamicPart: string;
  /** Null in play mode (architecture §14) — skips its own cache breakpoint
   * entirely rather than caching a placeholder, since a live game's
   * move-quality annotations aren't known upfront the way an already-
   * finished imported game's are (play mode folds the "game so far" into
   * the uncached currentMoveBlock instead — see renderGameSoFarInline). */
  annotatedPgn: string | null;
  otherMovesSummary: string;
  currentMoveBlock: string;
}

/** The request split the model call takes: the system layers as
 * `instructions` (the provider's own system slot), the episode's turns as
 * `messages`. Keeping them apart is what lets the cached prefix stay
 * byte-identical while the conversation grows underneath it. */
export interface EpisodeContext {
  instructions: SystemChatMessage[];
  messages: ChatMessage[];
}

/**
 * Design doc §5: four cached system blocks (static/dynamic/annotated-PGN/
 * other-moves), each with its own breakpoint, then the uncached
 * current-move block, then the episode's own conversation. Two leading
 * cached system messages already worked this way (the old
 * buildCacheableMessages) — this extends the same pattern to five.
 *
 * Play mode (architecture §14) uses only three cached breakpoints —
 * `annotatedPgn` is null, so its cachedSystemMessage is skipped entirely
 * rather than caching an empty/placeholder block. Analyze mode is
 * unaffected: `annotatedPgn` is always non-null there, so this branch is
 * always taken and the output is byte-for-byte what it always was.
 */
export function buildEpisodeMessages(layers: EpisodeLayers, episodeMessages: ChatMessage[]): EpisodeContext {
  // Four cached blocks below (static/dynamic/annotatedPgn/otherMovesSummary)
  // is Anthropic's exact per-request cache-breakpoint maximum (final review
  // #10) — a fifth cached layer can't just be added here without first
  // dropping one of these four, or the request will start failing at the
  // provider.
  const cachedLayers = [
    cachedSystemMessage(layers.staticPart),
    cachedSystemMessage(layers.dynamicPart),
    ...(layers.annotatedPgn !== null ? [cachedSystemMessage(layers.annotatedPgn)] : []),
    cachedSystemMessage(layers.otherMovesSummary)
  ];

  // An episode legitimately starts with no conversation of its own — the
  // coach's opening turn, and every jump to a move nobody has discussed yet.
  // Providers reject a request with an empty message list, so in that case
  // the current-move block becomes the thing the coach is responding to
  // rather than an instruction about it. Safe for prompt caching either way:
  // it is the one UNCACHED layer, and it sits after the last breakpoint, so
  // the cached prefix is byte-identical in both shapes.
  if (episodeMessages.length === 0) {
    return { instructions: cachedLayers, messages: [{ role: 'user', content: layers.currentMoveBlock }] };
  }

  return {
    instructions: [...cachedLayers, systemMessage(layers.currentMoveBlock)],
    messages: episodeMessages
  };
}

export interface BuildEpisodeContextInput extends CoachContextDependencies {
  /** Only `.gameId`/`.id` are read — `.currentPly` is deliberately ignored in
   * favor of the `currentPly` field below, which reflects any jump/
   * show_position update already applied earlier in this same turn (the
   * `session` object itself is whatever was fetched before that happened). */
  session: SessionRow;
  currentPly: number;
  historyAfterTurn: SessionMessageRow[];
  staticPart: string;
  dynamicPart: string;
  /** Which side the student is playing this game — restated in the
   * "## Current position" block every turn (coach-agent-system-prompt.ts
   * already fetches this once as `game.userColor`). */
  studentColor: 'white' | 'black';
  /** wraps `POST engine/analyze-position` (architecture §4) — always called
   * to populate the "## Current position" analysis; engine visibility is a
   * universal default, not a per-student opt-in. */
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
}

/** Assembles the five-layer request in place of the old whole-transcript
 * replay (design doc §5) — purely a function of what's in the DB right now,
 * so a session resumed on a different pod after a restart reconstructs the
 * same layering with no in-memory state. */
export async function buildEpisodeContext(input: BuildEpisodeContextInput): Promise<EpisodeContext> {
  const episode = currentEpisode(input.historyAfterTurn, input.currentPly);
  const orphanExtendedMessages = includeOrphanedToolCall(input.historyAfterTurn, episode.messages);
  const isPlayMode = input.session.mode === 'play';

  const [position, previousMovePosition, moveQualities, otherNotes, threads] = await Promise.all([
    getPositionAtPly(input.db, input.session.gameId, input.currentPly),
    input.currentPly > 0 ? getPositionAtPly(input.db, input.session.gameId, input.currentPly - 1) : undefined,
    fetchMoveQualities(input.db, input.session.gameId, isPlayMode),
    sessionMoveNotesRepo.listOtherPlies(input.db, input.session.id, input.currentPly),
    sessionsRepo.getThreads(input.db, input.session.id)
  ]);
  if (!position) throw new NotFoundError('Current position not found for this session');

  // Play mode (architecture §14): layer 3 is skipped entirely (annotatedPgn:
  // null) rather than caching a placeholder — a live game's move-quality
  // annotations aren't known upfront, so they're folded into the uncached
  // currentMoveBlock instead (gameSoFar, below).
  const annotatedPgn = isPlayMode ? null : renderAnnotatedPgn(moveQualities);
  const gameSoFar = isPlayMode ? renderGameSoFarInline(moveQualities) : undefined;
  const otherMovesSummary = renderOtherMovesSummary(otherNotes, moveQualities);
  // The engine's "top choice here" / "best line" analysis is always about
  // the position BEFORE the move under discussion — analyzePosition is
  // called on the pre-move fen for that reason. ply 0 (game start) has no
  // "before", so pre-move and current collapse to the same fen. The
  // "## Current position" text itself states the actual current position
  // (position.fen, after the move), not this pre-move fen — see
  // renderCurrentMoveBlock's own doc comment. Engine visibility is a
  // universal default (no per-student opt-in), so this is always fetched.
  const preMoveFen = previousMovePosition?.fen ?? position.fen;
  const playedMove = previousMovePosition ? position.moveSan : null;
  const analysis = await input.analyzePosition(preMoveFen);
  const isBestMove = playedMove !== null && analysis.bestMove === playedMove;
  // Fetched for every played move, not just non-best ones: it feeds both the
  // curated "played line" continuation (isBestMove branch skips that) AND
  // the raw "## Position full analyse" / "## Delta against best move" JSON
  // (packages/prompts's renderAnalysisSection), which apply regardless of
  // whether the played move was best. position.fen should already be warm
  // in position_evaluations by the time a session is open — see
  // deepen-analysis.ts's batching — so this is expected to be a cache hit,
  // not a new live-latency source.
  const postMoveAnalysis = playedMove !== null ? await input.analyzePosition(position.fen) : undefined;
  const featureDelta =
    playedMove !== null && !isBestMove ? computeFeatureDelta(analysis, preMoveFen, position.fen) : undefined;
  const classifiedMove = moveQualities.find((move) => move.ply === input.currentPly);
  // final review #8: the thread-ledger heading is composed inside
  // renderCurrentMoveBlock (packages/prompts), not here — all prompt text
  // lives in packages/prompts, matching the pattern renderAnnotatedPgn/
  // renderOtherMovesSummary already use for their own '## ' headings.
  const currentMoveBlock = renderCurrentMoveBlock(
    input.currentPly,
    position.fen,
    input.studentColor,
    renderThreadsBlock(threads),
    playedMove,
    { analysis, classifiedMove, postMoveAnalysis, featureDelta },
    gameSoFar
  );

  const episodeMessages = await resolveEpisodeReplay(input, input.session.id, orphanExtendedMessages, input.currentPly);

  return buildEpisodeMessages(
    {
      staticPart: input.staticPart,
      dynamicPart: input.dynamicPart,
      annotatedPgn,
      otherMovesSummary,
      currentMoveBlock
    },
    episodeMessages
  );
}

/** architecture §14: analyze mode reads the batch pipeline's classified
 * moves (analysesRepo, unchanged); play mode reads the live equivalent
 * (game_move_qualities) instead and never queries analysesRepo at all — a
 * play-mode game never gets an `analyses` row in the first place. Both
 * branches return the same AnnotatedMoveLike[] shape so every caller above
 * (renderAnnotatedPgn/renderGameSoFarInline/renderOtherMovesSummary/the
 * classifiedMove lookup) works unmodified regardless of which mode it came
 * from. */
async function fetchMoveQualities(
  db: Kysely<Database>,
  gameId: string,
  isPlayMode: boolean
): Promise<AnnotatedMoveLike[]> {
  if (isPlayMode) return gameMoveQualitiesRepo.listByGameId(db, gameId);
  const moves = await analysesRepo.findClassifiedMovesByGameId(db, gameId);
  return moves ?? [];
}

/**
 * What concretely changed on the board between the engine's best move and
 * the move actually played, for the "## Current position" curated summary
 * (packages/prompts's renderCurrentMoveBlock). Both computePositionFeatures
 * calls are pure chess.js analysis — no engine round-trip — the only new
 * cost here is applySanSequence replaying one hypothetical move.
 */
function computeFeatureDelta(
  analysis: PositionAnalysis | undefined,
  displayFen: string,
  postMoveFen: string
): FeatureDelta | undefined {
  if (!analysis?.bestMove) return undefined;
  const { moves, error } = applySanSequence(displayFen, [analysis.bestMove]);
  const bestMoveFen = moves[0]?.fen;
  if (error || !bestMoveFen) return undefined;
  return diffPositionFeatures(computePositionFeatures(bestMoveFen), computePositionFeatures(postMoveFen));
}
