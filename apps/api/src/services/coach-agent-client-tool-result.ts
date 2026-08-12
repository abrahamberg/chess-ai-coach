import type { Kysely } from 'kysely';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { currentEpisode } from '../lib/episodes.js';
import * as coachContext from './coach-context.js';
import { getPositionAtPly } from './game-positions.js';
import type { CoachAgentDependencies, StartTurnInput } from './coach-agent-types.js';

export interface AppliedClientToolResult {
  /** What the board/analysis now shows — moves on every show_position. */
  ply: number;
  /** What the conversation is actually about — moves only on a
   * subject-intent show_position (or doesn't move at all for every other
   * client tool). This turn's remaining messages get tagged with this, not
   * `ply` — see coach-agent-turn.ts. */
  subjectPly: number;
}

export async function applyClientToolResult(
  deps: CoachAgentDependencies,
  session: SessionRow,
  toolResult: NonNullable<StartTurnInput['clientToolResult']>,
  currentPly: number,
  subjectPly: number
): Promise<AppliedClientToolResult> {
  let result = toolResult.result;
  let ply = currentPly;
  let subject = subjectPly;
  if (toolResult.toolName === 'show_position') {
    const { ply: claimedPly, intent } = toolResult.result as { ply: number; intent?: 'flashback' | 'subject' };
    const position = await getPositionAtPly(deps.db, session.gameId, claimedPly);
    if (position) {
      ply = claimedPly;
      // Missing intent defaults to 'subject' (today's only behavior) —
      // defensive, since the schema requires it for every new call the
      // model makes; only reachable from a malformed/stale client.
      if ((intent ?? 'subject') === 'subject' && claimedPly !== subjectPly) {
        const historyBeforeTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
        const closedEpisode = currentEpisode(historyBeforeTurn, subjectPly);
        await coachContext.closeEpisodeIfNeeded(deps, session.id, closedEpisode.messages, subjectPly);
        subject = claimedPly;
        await sessionsRepo.updateSubjectAndCurrentPly(deps.db, session.id, ply);
      } else {
        // Flashback (or a same-ply subject call, effectively a no-op):
        // board moves, subject deliberately does not.
        await sessionsRepo.updateCurrentPly(deps.db, session.id, ply);
      }
    }
    result = await withAuthoritativeFen(deps.db, session.gameId, ply, toolResult.result);
  }
  await sessionMessagesRepo.insert(
    deps.db,
    session.id,
    'tool',
    [
      {
        type: 'tool-result',
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        // Tool output is a tagged union, not a bare value — see
        // `toModelToolResultPart` in coach-context-replay.ts, which upgrades
        // rows written before that was true.
        output: { type: 'json', value: result }
      }
    ],
    subject
  );
  return { ply, subjectPly: subject };
}

/**
 * The client reports {moveNumber, color, ply, intent} for a show_position
 * round-trip but never a FEN — so, left alone, this tool-result is the
 * coach's only
 * per-move checkpoint in the whole conversation and it carries no ground
 * truth about the actual position. Stamping the server-computed FEN onto it
 * here means the coach receives a verified FEN through the same in-band,
 * cache-safe channel the thread ledger uses (architecture §7.5), for every
 * position it ever shows — instead of silently reconstructing one from
 * memory when it later needs one for get_engine_analysis.
 */
async function withAuthoritativeFen(
  db: Kysely<Database>,
  gameId: string,
  ply: number,
  result: unknown
): Promise<unknown> {
  const position = await getPositionAtPly(db, gameId, ply);
  if (!position) return result;
  return { ...(result as object), fen: position.fen };
}
