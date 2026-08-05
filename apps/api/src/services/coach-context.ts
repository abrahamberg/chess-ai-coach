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
  renderOtherMovesSummary,
  renderThreadsBlock
} from '@chess-coach/prompts';
import type { PositionAnalysis } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
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
  annotatedPgn: string;
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
    cachedSystemMessage(layers.annotatedPgn),
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
  /** wraps `POST engine/analyze-position` (architecture §4) — only called
   * when `showEngineAnalysis` is true. */
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
  /** The student's opt-in raw-engine-analysis preference (docs/design.md
   * principle 4) — gates the full JSON analysis appended to the "## Current
   * position" block. Does NOT gate the pre-move fen/played-move sentence
   * themselves, which are a universal default for every student. */
  showEngineAnalysis: boolean;
}

/** Assembles the five-layer request in place of the old whole-transcript
 * replay (design doc §5) — purely a function of what's in the DB right now,
 * so a session resumed on a different pod after a restart reconstructs the
 * same layering with no in-memory state. */
export async function buildEpisodeContext(input: BuildEpisodeContextInput): Promise<EpisodeContext> {
  const episode = currentEpisode(input.historyAfterTurn, input.currentPly);
  const orphanExtendedMessages = includeOrphanedToolCall(input.historyAfterTurn, episode.messages);

  const [position, previousMovePosition, classifiedMoves, otherNotes, threads] = await Promise.all([
    getPositionAtPly(input.db, input.session.gameId, input.currentPly),
    input.currentPly > 0 ? getPositionAtPly(input.db, input.session.gameId, input.currentPly - 1) : undefined,
    analysesRepo.findClassifiedMovesByGameId(input.db, input.session.gameId),
    sessionMoveNotesRepo.listOtherPlies(input.db, input.session.id, input.currentPly),
    sessionsRepo.getThreads(input.db, input.session.id)
  ]);
  if (!position) throw new NotFoundError('Current position not found for this session');

  const annotatedPgn = renderAnnotatedPgn(classifiedMoves ?? []);
  const otherMovesSummary = renderOtherMovesSummary(otherNotes, classifiedMoves ?? []);
  // The board anchors one ply BEFORE a played move by default (universal
  // default — see useSessionBoardState.ts's isAnchoredPreMove), with a red
  // arrow for the move actually played. This block must describe what's
  // really on the board, so it uses the same pre-move fen and names the
  // played move in words; ply 0 (game start) has no "before" and is
  // unaffected. The full structured analysis is opt-in (showEngineAnalysis).
  const displayFen = previousMovePosition?.fen ?? position.fen;
  const playedMove = previousMovePosition ? position.moveSan : null;
  const analysis = input.showEngineAnalysis ? await input.analyzePosition(displayFen) : undefined;
  const isBestMove = playedMove !== null && analysis?.bestMove === playedMove;
  // Only fetch the played move's own continuation when there's something to
  // add beyond the best line already above (position.fen should already be
  // warm in position_evaluations by the time a session is open — see
  // deepen-analysis.ts's batching — so this is expected to be a cache hit,
  // not a new live-latency source).
  const postMoveAnalysis =
    input.showEngineAnalysis && playedMove !== null && !isBestMove ? await input.analyzePosition(position.fen) : undefined;
  const featureDelta =
    playedMove !== null && !isBestMove ? computeFeatureDelta(analysis, displayFen, position.fen) : undefined;
  const classifiedMove = classifiedMoves?.find((move) => move.ply === input.currentPly);
  // final review #8: the thread-ledger heading is composed inside
  // renderCurrentMoveBlock (packages/prompts), not here — all prompt text
  // lives in packages/prompts, matching the pattern renderAnnotatedPgn/
  // renderOtherMovesSummary already use for their own '## ' headings.
  const currentMoveBlock = renderCurrentMoveBlock(
    input.currentPly,
    displayFen,
    episode.previousPly,
    renderThreadsBlock(threads),
    playedMove,
    analysis ? { analysis, classifiedMove, postMoveAnalysis, featureDelta } : undefined
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
