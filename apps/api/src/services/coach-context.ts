import type { CoreMessage } from 'ai';
import type { Kysely } from 'kysely';
import { moveRefToPly } from '@chess-coach/chess-analysis';
import { renderAnnotatedPgn, renderCurrentMoveBlock, renderOtherMovesSummary, renderThreadsBlock } from '@chess-coach/prompts';
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
 */
export async function closeEpisodeIfNeeded(
  deps: CoachContextDependencies,
  sessionId: string,
  closedEpisodeMessages: SessionMessageRow[],
  closedPly: number
): Promise<void> {
  if (closedEpisodeMessages.length === 0) return;
  if (hasRecordMoveNoteCall(closedEpisodeMessages, closedPly)) return;

  const note = await compact(toStoredMessages(closedEpisodeMessages), null, deps.callLightModel);
  await sessionMoveNotesRepo.upsert(deps.db, sessionId, closedPly, note);
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
}

/** Assembles the five-layer request in place of the old whole-transcript
 * replay (design doc §5) — purely a function of what's in the DB right now,
 * so a session resumed on a different pod after a restart reconstructs the
 * same layering with no in-memory state. */
export async function buildEpisodeContext(input: BuildEpisodeContextInput): Promise<CoreMessage[]> {
  const episode = currentEpisode(input.historyAfterTurn, input.currentPly);

  const [position, classifiedMoves, otherNotes, threads] = await Promise.all([
    getPositionAtPly(input.db, input.session.gameId, input.currentPly),
    analysesRepo.findClassifiedMovesByGameId(input.db, input.session.gameId),
    sessionMoveNotesRepo.listOtherPlies(input.db, input.session.id, input.currentPly),
    sessionsRepo.getThreads(input.db, input.session.id)
  ]);
  if (!position) throw new NotFoundError('Current position not found for this session');

  const annotatedPgn = renderAnnotatedPgn(classifiedMoves ?? []);
  const otherMovesSummary = renderOtherMovesSummary(otherNotes, classifiedMoves ?? []);
  const currentMoveBlock = [
    renderCurrentMoveBlock(input.currentPly, position.fen, episode.previousPly),
    '## Your thread ledger',
    renderThreadsBlock(threads)
  ].join('\n\n');

  const episodeMessages = await resolveEpisodeReplay(input, input.session.id, episode.messages, input.currentPly);

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
    return prepared.replayMessages.map(toCoreMessage);
  }

  const keptCount = Math.ceil(stored.length / 2);
  const foldedMessages = stored.slice(0, stored.length - keptCount);
  const newDigest = await compact(foldedMessages, initialDigest, deps.callLightModel);
  await sessionMoveNotesRepo.upsert(deps.db, sessionId, currentPly, newDigest);

  const kept = stored.slice(stored.length - keptCount);
  const digestMessage: StoredMessage = { id: 'digest', role: 'user', content: `[this move so far] ${newDigest}` };
  return [digestMessage, ...kept].map(toCoreMessage);
}

function toStoredMessages(messages: SessionMessageRow[]): StoredMessage[] {
  return messages.map((message) => ({ id: message.id, role: message.role, content: message.content }));
}

function toCoreMessage(message: StoredMessage): CoreMessage {
  return { role: message.role, content: message.content } as CoreMessage;
}

function hasRecordMoveNoteCall(messages: SessionMessageRow[], ply: number): boolean {
  return messages.some(
    (message) => Array.isArray(message.content) && message.content.some((part) => isRecordMoveNoteCallForPly(part, ply))
  );
}

function isRecordMoveNoteCallForPly(part: unknown, ply: number): boolean {
  if (typeof part !== 'object' || part === null) return false;
  const candidate = part as { type?: unknown; toolName?: unknown; args?: unknown };
  if (candidate.type !== 'tool-call' || candidate.toolName !== 'record_move_note') return false;
  return (candidate.args as { ply?: unknown } | undefined)?.ply === ply;
}
