import {
  annotateBoardParameters,
  buildInterpreterMessages,
  checkPositionParameters,
  endSessionParameters,
  getEngineAnalysisParameters,
  getUserProfileParameters,
  proposeFocusAreaUpdateParameters,
  recallMoveParameters,
  recordFindingParameters,
  recordMoveNoteParameters,
  renderFocusAreasBlock,
  renderRecentFindingsBlock,
  showPositionParameters,
  updateThreadsParameters
} from '@chess-coach/prompts';
import { moveRefToPly } from '@chess-coach/chess-analysis';
import type { EngineEval, EngineLine, Finding, FocusAreaUpdate, Thread } from '@chess-coach/shared';
import { tool, type ToolSet } from 'ai';
import type { Kysely } from 'kysely';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import { getPositionAtPly } from './game-positions.js';
import { recallMove, recordMoveNote, type MoveAddress } from './move-notes.js';
import * as progressService from './progress.js';
import { createThreadsService } from './threads.js';
import * as userProfileService from './user-profile.js';

export interface CoachToolsContext {
  userId: string;
  sessionId: string;
  gameId: string;
}

export interface CoachToolsDependencies {
  db: Kysely<Database>;
  jobQueue?: JobQueue;
  /** wraps `POST engine/analyze-position` (architecture §4). */
  analyzePosition: (fen: string) => Promise<EngineEval>;
  /** wraps the gateway's light-tier model call; returns the raw model text. */
  callLightModel: (messages: { system: string; user: string }) => Promise<string>;
}

/** architecture §8.3: max 2 get_engine_analysis calls, 1 get_user_profile call
 * per turn. Over budget the tool returns an error object instead of executing. */
const TOOL_BUDGETS: Partial<Record<string, number>> = {
  get_engine_analysis: 2,
  get_user_profile: 1,
  recall_move: 3
};
const BUDGET_EXHAUSTED = { error: 'budget_exhausted — answer with what you have' } as const;

interface TurnGuardState {
  callCounts: Map<string, number>;
  cache: Map<string, unknown>;
}

/** Fresh budget/repeat-call state per call — buildCoachTools is expected to be
 * called once per agent turn (architecture §8.3's guardrails are per-turn). */
export function buildCoachTools(ctx: CoachToolsContext, deps: CoachToolsDependencies): ToolSet {
  const guardState: TurnGuardState = { callCounts: new Map(), cache: new Map() };

  return {
    show_position: tool({
      description:
        "Move the student's board to a given position, addressed by move number and color (e.g. White's move 12 is { moveNumber: 12, color: 'white' }; the game start is { moveNumber: 0, color: null }). Always call this before discussing a new position.",
      parameters: showPositionParameters
    }),
    annotate_board: tool({
      description: 'Draw arrows/highlights on the board. Cleared on the next show_position.',
      parameters: annotateBoardParameters
    }),
    check_position: tool({
      description:
        "Silently look up the FEN for any move in THIS game, addressed the same way as show_position ({ moveNumber, color }; the game start is { moveNumber: 0, color: null }). Does not move the student's board. Use this to get a verified fen before calling get_engine_analysis, or to check a claim about the position before you say it out loud — never guess or reconstruct a FEN from memory.",
      parameters: checkPositionParameters,
      execute: withTurnGuards(guardState, 'check_position', (args: { moveNumber: number; color: 'white' | 'black' | null }) =>
        checkPosition(deps, ctx, args)
      )
    }),
    get_engine_analysis: tool({
      description:
        "Check a position with the engine and get a plain-language answer to a specific chess question. Never returns raw evaluations.",
      parameters: getEngineAnalysisParameters,
      execute: withTurnGuards(guardState, 'get_engine_analysis', (args) => getEngineAnalysis(deps, args))
    }),
    get_user_profile: tool({
      description: "Read the student's focus areas, recent findings, and session history.",
      parameters: getUserProfileParameters,
      execute: withTurnGuards(guardState, 'get_user_profile', () => getUserProfileText(deps.db, ctx.userId))
    }),
    record_finding: tool({
      description: "Record a durable observation about the student's thinking or habits.",
      parameters: recordFindingParameters,
      execute: withTurnGuards(guardState, 'record_finding', (finding: Finding) =>
        recordFindingTool(deps.db, ctx, finding)
      )
    }),
    propose_focus_area_update: tool({
      description: 'Create, progress, regress, or resolve a focus area based on evidence this session.',
      parameters: proposeFocusAreaUpdateParameters,
      execute: withTurnGuards(guardState, 'propose_focus_area_update', (update: FocusAreaUpdate) =>
        progressService.applyFocusAreaUpdate(deps.db, ctx.userId, update)
      )
    }),
    update_threads: tool({
      description:
        "Backstage conversation-thread ledger. Call only when parking, resuming, or resolving a topic.",
      parameters: updateThreadsParameters,
      execute: withTurnGuards(guardState, 'update_threads', (args: { threads: Thread[] }) =>
        createThreadsService(deps.db).replace(ctx.sessionId, args.threads)
      )
    }),
    record_move_note: tool({
      description:
        "Save a one-sentence note on a move you're about to leave, for your own later reference (e.g. \"missed Rxd5, discussed the pin, assigned as homework\"). Addressed the same way as show_position/check_position ({ moveNumber, color }; e.g. White's move 12 is { moveNumber: 12, color: 'white' }) — never a bare ply. Worth calling most of the time you leave a moment — not mechanically every single time.",
      parameters: recordMoveNoteParameters,
      execute: withTurnGuards(guardState, 'record_move_note', (args: MoveNoteArgs) => recordMoveNote(deps.db, ctx, args))
    }),
    recall_move: tool({
      description:
        "Look up more detail on a specific earlier move in THIS session than the one-line summary already gives you. Addressed the same way as show_position/check_position ({ moveNumber, color }) — never a bare ply.",
      parameters: recallMoveParameters,
      execute: withTurnGuards(guardState, 'recall_move', (args: MoveAddress) => recallMoveTool(deps, ctx, args))
    }),
    end_session: tool({
      description: 'Mark the session complete and trigger the post-session progress summary.',
      parameters: endSessionParameters,
      execute: withTurnGuards(guardState, 'end_session', () => endSessionTool(deps, ctx))
    })
  };
}

function withTurnGuards<Args, Result>(
  state: TurnGuardState,
  name: string,
  fn: (args: Args) => Promise<Result>
): (args: Args) => Promise<Result | typeof BUDGET_EXHAUSTED> {
  return async (args: Args) => {
    const cacheKey = `${name}:${JSON.stringify(args)}`;
    const cached = state.cache.get(cacheKey);
    if (cached !== undefined) return cached as Result;

    const budget = TOOL_BUDGETS[name];
    if (budget !== undefined && (state.callCounts.get(name) ?? 0) >= budget) {
      return BUDGET_EXHAUSTED;
    }
    if (budget !== undefined) {
      state.callCounts.set(name, (state.callCounts.get(name) ?? 0) + 1);
    }

    const result = await fn(args);
    state.cache.set(cacheKey, result);
    return result;
  };
}

interface EngineAnalysisArgs {
  fen: string;
  question: string;
}

/** architecture §7.4.4: the coach never sees raw engine lines — the light-tier
 * interpreter subagent digests them into a short plain-language answer first. */
async function getEngineAnalysis(
  deps: CoachToolsDependencies,
  args: EngineAnalysisArgs
): Promise<{ text: string }> {
  const engineEval = await deps.analyzePosition(args.fen);
  const messages = buildInterpreterMessages({
    fen: args.fen,
    depth: engineEval.depth,
    multiPv: engineEval.lines.length,
    engineLines: renderEngineLines(engineEval.lines),
    question: args.question
  });
  const text = await deps.callLightModel(messages);
  return { text: `[engine check] ${text}` };
}

interface CheckPositionArgs {
  moveNumber: number;
  color: 'white' | 'black' | null;
}

type MoveNoteArgs = MoveAddress & { note: string };

async function checkPosition(
  deps: CoachToolsDependencies,
  ctx: CoachToolsContext,
  args: CheckPositionArgs
): Promise<{ fen: string; moveSan: string | null } | { error: string }> {
  const ply = moveRefToPly(args.moveNumber, args.color);
  const position = await getPositionAtPly(deps.db, ctx.gameId, ply);
  if (!position) return { error: 'that move does not exist in this game' };
  return { fen: position.fen, moveSan: position.moveSan };
}

async function recallMoveTool(
  deps: CoachToolsDependencies,
  ctx: CoachToolsContext,
  args: MoveAddress
): Promise<{ text: string } | { error: string }> {
  const session = await sessionsRepo.findById(deps.db, ctx.sessionId);
  return recallMove(deps, { sessionId: ctx.sessionId, gameId: ctx.gameId, currentPly: session?.currentPly ?? 0 }, args);
}

function renderEngineLines(lines: EngineLine[]): string {
  return lines
    .map((line, index) => {
      const score = line.mateIn !== null ? `mate in ${line.mateIn}` : `${(line.cp ?? 0) / 100}`;
      return `${index + 1}. ${line.moveSan} (${score})`;
    })
    .join('\n');
}

async function getUserProfileText(db: Kysely<Database>, userId: string): Promise<string> {
  const summary = await userProfileService.getProfileSummary(db, userId);
  const now = new Date();
  const findingCounts =
    Object.entries(summary.findingCounts)
      .map(([category, count]) => `${category}: ${count}`)
      .join(', ') || 'none';

  return [
    `FOCUS AREAS\n${renderFocusAreasBlock(summary.focusAreas, now)}`,
    `RECENT FINDINGS\n${renderRecentFindingsBlock(summary.recentFindings, now)}`,
    `FINDING COUNTS (last 20 games)\n${findingCounts}`,
    `SESSIONS TOGETHER: ${summary.sessionCount}`
  ].join('\n\n');
}

async function recordFindingTool(
  db: Kysely<Database>,
  ctx: CoachToolsContext,
  finding: Finding
): Promise<{ recorded: boolean }> {
  await progressService.recordFinding(db, ctx.userId, ctx.sessionId, ctx.gameId, finding);
  return { recorded: true };
}

async function endSessionTool(
  deps: CoachToolsDependencies,
  ctx: CoachToolsContext
): Promise<{ ended: boolean }> {
  await progressService.completeSession(deps.db, ctx.sessionId);
  await deps.jobQueue?.enqueueSummarizeSession(ctx.sessionId);
  return { ended: true };
}
