import { classifyMoves, findCandidateMoments, parsePgn } from '@chess-coach/chess-analysis';
import { CoachingPlanSchema, type CoachingPlan, type EngineEval } from '@chess-coach/shared';
import { buildPlannerMessages, type PlannerPromptInput } from '@chess-coach/prompts';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';

export interface PlannerMessages {
  system: string;
  user: string;
}

export interface AnalysisJobDependencies {
  /** Wraps `POST engine/analyze-game` (architecture §4). */
  analyzeGamePositions: (fens: string[]) => Promise<EngineEval[]>;
  /** Wraps the gateway's light-tier model call; returns the raw model text. */
  callPlanner: (messages: PlannerMessages) => Promise<string>;
}

/**
 * architecture §5 `analyze-game` job: engine_running -> (evals) -> planning ->
 * (validated plan) -> ready, or failed with `error` set on any step's failure.
 *
 * Findings/focus-areas aren't wired into the planner prompt yet — those repos
 * are Task 5.1's — so this passes empty history; `buildPlannerMessages` renders
 * that as its normal "(none yet…)" fallback, which is also just correct for a
 * user's first analyzed game.
 */
export async function runAnalyzeGameJob(
  db: Kysely<Database>,
  deps: AnalysisJobDependencies,
  gameId: string
): Promise<void> {
  const analysis = await analysesRepo.findByGameId(db, gameId);
  if (!analysis) throw new Error(`No analysis row for game ${gameId}`);

  try {
    await analysesRepo.updateStatus(db, analysis.id, 'engine_running');

    const game = await gamesRepo.findById(db, gameId);
    if (!game) throw new Error(`Game ${gameId} not found`);
    const user = await usersRepo.findById(db, game.userId);
    if (!user) throw new Error(`User ${game.userId} not found`);

    const parsedGame = parsePgn(game.pgn);
    const fens = parsedGame.positions.map((position) => position.fen);
    const evals = await deps.analyzeGamePositions(fens);
    await analysesRepo.storeEngineEvals(db, analysis.id, evals);

    const classifiedMoves = classifyMoves(parsedGame, evals, game.userColor);
    await analysesRepo.storeClassifiedMoves(db, analysis.id, classifiedMoves);
    const candidateMoments = findCandidateMoments(classifiedMoves, evals);

    await analysesRepo.updateStatus(db, analysis.id, 'planning');

    const plannerInput: PlannerPromptInput = {
      band: user.ratingBand,
      focusAreas: [],
      recentFindings: [],
      selfAssessment: user.selfAssessment,
      userColor: game.userColor,
      moves: classifiedMoves,
      candidateMoments
    };
    const plan = await generatePlanWithRetry(deps, plannerInput);

    await analysesRepo.markReady(db, analysis.id, plan);
  } catch (error) {
    await analysesRepo.markFailed(db, analysis.id, describeError(error));
  }
}

async function generatePlanWithRetry(
  deps: AnalysisJobDependencies,
  input: PlannerPromptInput
): Promise<CoachingPlan> {
  const messages = buildPlannerMessages(input);

  const first = CoachingPlanSchema.safeParse(safeJsonParse(await deps.callPlanner(messages)));
  if (first.success) return first.data;

  const retryMessages: PlannerMessages = {
    system: messages.system,
    user: `${messages.user}\n\nVALIDATION ERROR — your previous output failed schema validation: ${JSON.stringify(first.error.issues)}\nFix it and output ONLY the corrected JSON object.`
  };
  const second = CoachingPlanSchema.safeParse(safeJsonParse(await deps.callPlanner(retryMessages)));
  if (second.success) return second.data;

  throw new Error(`Planner output failed validation twice: ${JSON.stringify(second.error.issues)}`);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
