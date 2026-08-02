import type { CoreMessage } from 'ai';
import type { Kysely } from 'kysely';
import { moveRefToPly } from '@chess-coach/chess-analysis';
import {
  EPISODE_FOLD_SYSTEM_PROMPT,
  renderAnnotatedPgn,
  renderCurrentMoveBlock,
  renderOtherMovesSummary,
  renderThreadsBlock
} from '@chess-coach/prompts';
import type { PositionAnalysis } from '@chess-coach/shared';
import * as analysesRepo from '../db/repositories/analyses.js';
import type { SessionMessageRow } from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import { currentEpisode } from '../lib/episodes.js';
import { getPositionAtPly } from './game-positions.js';
import { compact, prepareContext, type StoredMessage, type SummarizeFn } from './session-context.js';

const EPISODE_BUDGET_TOKENS = 6000;
const POSITION_CONTEXT_PATTERN = /^\[position_context\] Back at move (\d+) \((white|black)\),/;

export interface CoachContextDependencies {
  db: Kysely<Database>;
  callLightModel: SummarizeFn;
}

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

/**
 * Design doc §3: when an episode closes (the coach or the student moves on
 * from `closedPly`) without a coach-authored record_move_note for that ply,
 * fold its raw messages into one automatically so the next turn's
 * other-moves-summary still has something to say about it.
 *
 * Best-effort (final review #3): this runs in the critical path of both its
 * callers (coach-agent.ts's show_position jump-handling and
 * applyClientToolResult), inside the session lock, BEFORE the ply advances
 * and the tool-result is persisted. A transient light-model failure here
 * must never abort the turn — losing one auto-note doesn't corrupt
 * anything, it just leaves that episode's note missing until a later close
 * or an explicit recall_move.
 */
export async function closeEpisodeIfNeeded(
  deps: CoachContextDependencies,
  sessionId: string,
  closedEpisodeMessages: SessionMessageRow[],
  closedPly: number
): Promise<void> {
  if (closedEpisodeMessages.length === 0) return;
  if (hasSuccessfulRecordMoveNoteCall(closedEpisodeMessages, closedPly)) return;

  try {
    // final review #6: seed from this ply's own earlier closing note (e.g.
    // a previous visit's fold), never a hardcoded null — otherwise a
    // revisit's close would silently discard what the first visit already
    // established about this move.
    const existingNote = await sessionMoveNotesRepo.findByPly(deps.db, sessionId, closedPly);
    const note = await compact(
      toStoredMessages(closedEpisodeMessages),
      existingNote?.note ?? null,
      deps.callLightModel,
      EPISODE_FOLD_SYSTEM_PROMPT,
      { appendOpenThreads: false }
    );
    await sessionMoveNotesRepo.upsert(deps.db, sessionId, closedPly, note);
  } catch (error) {
    console.error(`closeEpisodeIfNeeded: failed to auto-fold episode (session ${sessionId}, ply ${closedPly}):`, error);
  }
}

export interface EpisodeLayers {
  staticPart: string;
  dynamicPart: string;
  annotatedPgn: string;
  otherMovesSummary: string;
  currentMoveBlock: string;
}

/**
 * Design doc §5: four cached system blocks (static/dynamic/annotated-PGN/
 * other-moves), each with its own breakpoint, then the uncached
 * current-move block, then the episode's own conversation. Two leading
 * cached system messages already worked this way (the old
 * buildCacheableMessages) — this extends the same pattern to five.
 */
export function buildEpisodeMessages(layers: EpisodeLayers, episodeMessages: CoreMessage[]): CoreMessage[] {
  // Four breakpoints below (static/dynamic/annotatedPgn/otherMovesSummary) is
  // Anthropic's exact per-request cache-breakpoint maximum (final review
  // #10) — a fifth cached layer can't just be added here without first
  // dropping one of these four, or the request will start failing at the
  // provider.
  const cacheControl = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
  return [
    { role: 'system', content: layers.staticPart, providerOptions: cacheControl },
    { role: 'system', content: layers.dynamicPart, providerOptions: cacheControl },
    { role: 'system', content: layers.annotatedPgn, providerOptions: cacheControl },
    { role: 'system', content: layers.otherMovesSummary, providerOptions: cacheControl },
    { role: 'system', content: layers.currentMoveBlock },
    ...episodeMessages
  ];
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
export async function buildEpisodeContext(input: BuildEpisodeContextInput): Promise<CoreMessage[]> {
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
    analysis
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
 * Long-running-episode safety net (design doc §3): reuses session-
 * context.ts's budget/cooldown compaction, scoped to just this episode.
 * `findByPly` may return a note from *this same* open episode's own earlier
 * fold, or — on a revisit — the closing note from an *earlier, separate*
 * visit to this exact ply. Either way it's used as the seed digest: on a
 * revisit that's a deliberate, small carry-over ("what did we already
 * conclude about this move last time"), not the raw-replay confusion the
 * episode boundary exists to prevent — only a past visit's *raw messages*
 * are excluded from this episode's scan (lib/episodes.ts's currentEpisode),
 * never its one-line note.
 */
async function resolveEpisodeReplay(
  deps: CoachContextDependencies,
  sessionId: string,
  episodeMessages: SessionMessageRow[],
  currentPly: number
): Promise<CoreMessage[]> {
  const stored = toStoredMessages(episodeMessages);
  const existingNote = await sessionMoveNotesRepo.findByPly(deps.db, sessionId, currentPly);
  const initialDigest = existingNote?.note ?? null;
  const prepared = prepareContext(stored, initialDigest, EPISODE_BUDGET_TOKENS);

  if (!prepared.needsCompaction) {
    return withEpisodeDigest(initialDigest, stored).map(toCoreMessage);
  }

  const keptCount = Math.ceil(stored.length / 2);
  if (keptCount === stored.length) {
    // Nothing left to fold (e.g. a single oversized message) — replay
    // verbatim rather than compacting an empty slice and clobbering the
    // note for no token savings.
    return withEpisodeDigest(initialDigest, stored).map(toCoreMessage);
  }

  // final review #2: the naive fold point (stored.length - keptCount) is
  // purely positional — it can land between a server-executed tool-call and
  // its tool-result (get_engine_analysis, check_position, record_finding,
  // update_threads all persist that adjacent pair). If it does, `kept`
  // would start with a bare tool_result, a shape both Anthropic and OpenAI
  // reject — and since the provider rejection means onFinish never runs,
  // the same bad cut would recur every subsequent turn. Same fix as
  // includeOrphanedToolCall uses for the outer episode boundary: extend the
  // cut back one message when it lands on an orphaned tool-result.
  const keptStart = extendPastOrphanedToolResult(episodeMessages, stored.length - keptCount);
  const foldedMessages = stored.slice(0, keptStart);
  const newDigest = await compact(
    foldedMessages,
    initialDigest,
    deps.callLightModel,
    EPISODE_FOLD_SYSTEM_PROMPT,
    { appendOpenThreads: false }
  );
  await sessionMoveNotesRepo.upsert(deps.db, sessionId, currentPly, newDigest);

  const kept = stored.slice(keptStart);
  return withEpisodeDigest(newDigest, kept).map(toCoreMessage);
}

function withEpisodeDigest(digest: string | null, messages: StoredMessage[]): StoredMessage[] {
  if (!digest) return messages;
  const digestMessage: StoredMessage = { id: 'digest', role: 'user', content: `[this move so far] ${digest}` };
  return [digestMessage, ...messages];
}

function toStoredMessages(messages: SessionMessageRow[]): StoredMessage[] {
  return messages.map((message) => ({ id: message.id, role: message.role, content: message.content }));
}

function toCoreMessage(message: StoredMessage): CoreMessage {
  return { role: message.role, content: message.content } as CoreMessage;
}

/**
 * final review #7: trusts the tool-CALL and its RESULT, not just the call —
 * if record_move_note returned `{ error: ... }` (e.g. an address that
 * doesn't resolve to a real move in this game), the auto-fallback must
 * still run, or the episode ends up with no note at all. Correlates a
 * record_move_note tool-call for this ply with its tool-result via
 * toolCallId, the same way includeOrphanedToolCall/
 * extendPastOrphanedToolResult correlate a call with its result below.
 */
function hasSuccessfulRecordMoveNoteCall(messages: SessionMessageRow[], ply: number): boolean {
  const callIds = collectRecordMoveNoteCallIds(messages, ply);
  if (callIds.size === 0) return false;
  return messages.some((message) => hasSuccessfulToolResult(message, callIds));
}

function collectRecordMoveNoteCallIds(messages: SessionMessageRow[], ply: number): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const callId = recordMoveNoteCallIdForPly(part, ply);
      if (callId) ids.add(callId);
    }
  }
  return ids;
}

function recordMoveNoteCallIdForPly(part: unknown, ply: number): string | null {
  if (typeof part !== 'object' || part === null) return null;
  const candidate = part as { type?: unknown; toolName?: unknown; toolCallId?: unknown; args?: unknown };
  if (candidate.type !== 'tool-call' || candidate.toolName !== 'record_move_note') return null;
  const args = candidate.args as { moveNumber?: unknown; color?: unknown } | undefined;
  if (typeof args?.moveNumber !== 'number') return null;
  const color = (args.color === 'white' || args.color === 'black' ? args.color : null) as 'white' | 'black' | null;
  if (moveRefToPly(args.moveNumber, color) !== ply) return null;
  return typeof candidate.toolCallId === 'string' ? candidate.toolCallId : null;
}

function hasSuccessfulToolResult(message: SessionMessageRow, callIds: Set<string>): boolean {
  if (message.role !== 'tool' || !Array.isArray(message.content)) return false;
  return message.content.some((part) => isSuccessfulRecordMoveNoteResult(part, callIds));
}

function isSuccessfulRecordMoveNoteResult(part: unknown, callIds: Set<string>): boolean {
  if (typeof part !== 'object' || part === null) return false;
  const candidate = part as { type?: unknown; toolCallId?: unknown; result?: unknown };
  if (candidate.type !== 'tool-result' || typeof candidate.toolCallId !== 'string') return false;
  if (!callIds.has(candidate.toolCallId)) return false;
  const result = candidate.result as { recorded?: unknown } | undefined;
  return result?.recorded === true;
}

/**
 * design doc §1 addendum: a show_position tool-call is written at the OLD
 * ply (messages in one turn are tagged uniformly with whatever was current
 * when the turn started — the move isn't client-confirmed yet), while its
 * tool-result is written at the NEW ply once the client confirms, one turn
 * later. currentEpisode's plain ply-match scan then starts the new episode
 * at the bare tool-result, with no tool-call earlier in the same episode —
 * a shape both Anthropic and OpenAI reject. This reaches exactly one
 * message further back, across the ply boundary, only when the episode's
 * very first message is such an orphan.
 */
function includeOrphanedToolCall(
  historyAfterTurn: SessionMessageRow[],
  episodeMessages: SessionMessageRow[]
): SessionMessageRow[] {
  const boundaryIndex = historyAfterTurn.length - episodeMessages.length;
  const adjustedStart = extendPastOrphanedToolResult(historyAfterTurn, boundaryIndex);
  return adjustedStart === boundaryIndex ? episodeMessages : historyAfterTurn.slice(adjustedStart);
}

/**
 * final review #2: shared by includeOrphanedToolCall (the outer episode
 * boundary) and resolveEpisodeReplay's compaction fold point — both cut a
 * message array at some index and both need the same guard: if the message
 * the cut would start on is a tool-result whose toolCallId matches a
 * tool-call earlier in the array, the cut lands between a tool-call and its
 * result, a shape both Anthropic and OpenAI reject. In that case the start
 * index moves back to that tool-call's message, pulling it (and everything
 * after it) in; otherwise the index is returned unchanged.
 *
 * The owning tool-call is usually the immediately preceding message, but one
 * assistant step can make several tool-calls whose results land on separate
 * messages/plies (e.g. a client tool's result, confirmed a turn later, sits
 * after another tool's same-step result was already persisted) — so this
 * walks back through any such sibling tool-result messages to find it,
 * rather than only checking one message back.
 */
function extendPastOrphanedToolResult(all: SessionMessageRow[], startIndex: number): number {
  const first = all[startIndex];
  const toolCallId = first ? firstToolResultCallId(first) : null;
  if (!toolCallId) return startIndex;

  for (let i = startIndex - 1; i >= 0; i--) {
    const candidate = all[i];
    if (!candidate) break;
    if (hasToolCall(candidate, toolCallId)) return i;
    if (candidate.role !== 'tool') break;
  }
  return startIndex;
}

function firstToolResultCallId(message: SessionMessageRow): string | null {
  if (message.role !== 'tool' || !Array.isArray(message.content)) return null;
  for (const part of message.content) {
    if (typeof part !== 'object' || part === null) continue;
    const candidate = part as { type?: unknown; toolCallId?: unknown };
    if (candidate.type === 'tool-result' && typeof candidate.toolCallId === 'string') return candidate.toolCallId;
  }
  return null;
}

function hasToolCall(message: SessionMessageRow, toolCallId: string): boolean {
  if (!Array.isArray(message.content)) return false;
  return message.content.some((part) => {
    if (typeof part !== 'object' || part === null) return false;
    const candidate = part as { type?: unknown; toolCallId?: unknown };
    return candidate.type === 'tool-call' && candidate.toolCallId === toolCallId;
  });
}
