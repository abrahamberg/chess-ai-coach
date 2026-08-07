import {
  getCandidateMovesParameters,
  playCoachMoveParameters,
  playCoachToolDescription,
  undoLastMoveParameters
} from '@chess-coach/prompts';
import { tool, type ToolSet } from '../llm/tools.js';
import { withTurnGuards, type TurnGuardState } from './coach-tool-guards.js';
import type { CoachToolsContext, CoachToolsDependencies } from './coach-tools.js';
import { getCandidateMoveBriefing } from './play-candidates.js';
import { commitCoachMove, undoLastMove } from './play-moves.js';
import * as userProfileService from './user-profile.js';

/** architecture §14: play mode's 3 additional tools (get_candidate_moves,
 * play_coach_move, undo_last_move) — thin adapters over the play-* services,
 * no SQL/business logic here (AGENTS.md layering rule). Shares the calling
 * turn's guardState with coach-tools.ts's analyze-mode tools rather than
 * creating its own, so budgets stay per-turn across the combined tool set. */
export function buildPlayCoachTools(
  ctx: CoachToolsContext,
  deps: CoachToolsDependencies,
  guardState: TurnGuardState
): ToolSet {
  return {
    get_candidate_moves: tool({
      description: playCoachToolDescription('get_candidate_moves'),
      inputSchema: getCandidateMovesParameters,
      execute: withTurnGuards(guardState, 'get_candidate_moves', (args: { fen: string }) =>
        getCandidateMovesTool(deps, ctx, args)
      )
    }),
    play_coach_move: tool({
      description: playCoachToolDescription('play_coach_move'),
      inputSchema: playCoachMoveParameters,
      execute: withTurnGuards(guardState, 'play_coach_move', (args: { san: string }) =>
        commitCoachMove(deps, ctx.gameId, args.san)
      )
    }),
    undo_last_move: tool({
      description: playCoachToolDescription('undo_last_move'),
      inputSchema: undoLastMoveParameters,
      execute: withTurnGuards(guardState, 'undo_last_move', () => undoLastMove(deps, ctx.sessionId, ctx.gameId))
    })
  };
}

async function getCandidateMovesTool(
  deps: CoachToolsDependencies,
  ctx: CoachToolsContext,
  args: { fen: string }
): Promise<{ briefing: string }> {
  const profile = await userProfileService.getProfileSummary(deps.db, ctx.userId);
  const focusAreas = profile.focusAreas.map((area) => area.category);
  const briefing = await getCandidateMoveBriefing(deps, args.fen, focusAreas);
  return { briefing };
}
