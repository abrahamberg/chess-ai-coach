import type { Kysely } from 'kysely';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { currentEpisode } from '../lib/episodes.js';
import * as coachContext from './coach-context.js';
import { getPositionAtPly } from './game-positions.js';
import type { CoachAgentDependencies, StartTurnInput } from './coach-agent-types.js';

export async function applyClientToolResult(
  deps: CoachAgentDependencies,
  session: SessionRow,
  toolResult: NonNullable<StartTurnInput['clientToolResult']>,
  currentPly: number
): Promise<number> {
  let result = toolResult.result;
  let ply = currentPly;
  if (toolResult.toolName === 'show_position') {
    const { ply: claimedPly } = toolResult.result as { ply: number };
    const position = await getPositionAtPly(deps.db, session.gameId, claimedPly);
    if (position) {
      if (claimedPly !== currentPly) {
        const historyBeforeTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
        const closedEpisode = currentEpisode(historyBeforeTurn, currentPly);
        await coachContext.closeEpisodeIfNeeded(deps, session.id, closedEpisode.messages, currentPly);
      }
      ply = claimedPly;
      await sessionsRepo.updateCurrentPly(deps.db, session.id, ply);
    }
    result = await withAuthoritativeFen(deps.db, session.gameId, ply, toolResult.result);
  }
  await sessionMessagesRepo.insert(
    deps.db,
    session.id,
    'tool',
    [{ type: 'tool-result', toolCallId: toolResult.toolCallId, toolName: toolResult.toolName, result }],
    ply
  );
  return ply;
}

/**
 * The client reports {moveNumber, color, ply} for a show_position round-trip
 * but never a FEN — so, left alone, this tool-result is the coach's only
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
