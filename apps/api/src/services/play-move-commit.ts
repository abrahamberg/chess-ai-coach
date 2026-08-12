import type { Kysely } from 'kysely';
import type { MoveQuality, PositionAnalysis } from '@chess-coach/shared';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { currentEpisode } from '../lib/episodes.js';
import { closeEpisodeIfNeeded, type CoachContextDependencies } from './coach-context.js';
import { commitPlayerMove } from './play-moves.js';

export interface CommitPlayerMoveDependencies extends CoachContextDependencies {
  db: Kysely<Database>;
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
}

export interface CommittedPlayerMove {
  fen: string;
  san: string;
  ply: number;
  quality: MoveQuality;
}

/**
 * The student's move (architecture §14) — validated and persisted, with
 * sessions.currentPly/subjectPly updated immediately, before any chat turn exists to
 * race it (unlike the coach's own move, which is committed mid-turn and has
 * to defer its ply update past onFinish — see coach-agent-turn.ts's
 * advancePlyForPlayMove). Closes the episode for the PRIOR ply first,
 * mirroring the same closeEpisodeIfNeeded-then-advance ordering
 * coach-agent-turn.ts already uses for position jumps — a no-op except on
 * the session's very first move, when there's nothing yet to fold.
 */
export async function commitPlayerMoveAndAdvance(
  deps: CommitPlayerMoveDependencies,
  session: SessionRow,
  san: string
): Promise<CommittedPlayerMove | { error: string }> {
  const result = await commitPlayerMove(deps, session.gameId, san);
  if ('error' in result) return result;

  const historyBeforeClose = await sessionMessagesRepo.listBySession(deps.db, session.id);
  const closedEpisode = currentEpisode(historyBeforeClose, session.subjectPly);
  await closeEpisodeIfNeeded(deps, session.id, closedEpisode.messages, session.subjectPly);
  // A newly-played move is always a subject change — see the matching
  // comment in coach-agent-turn.ts's advancePlyForPlayMove.
  await sessionsRepo.updateSubjectAndCurrentPly(deps.db, session.id, result.ply);

  return result;
}
