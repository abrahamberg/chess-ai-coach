import { classifyMoves, findCandidateMoments, parsePgn } from '@chess-coach/chess-analysis';
import type { CoachingPlan, EngineEval } from '@chess-coach/shared';
import { buildPlannerMessages, type PlannerPromptInput } from '@chess-coach/prompts';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';

/** Positions per engine call. Small enough that the progress percentage moves
 * often, large enough not to pay per-request overhead on every ply — and it
 * keeps each browser-mode tunnel request comfortably inside its timeout. */
const ENGINE_CHUNK_POSITIONS = 6;

export interface PlannerMessages {
  system: string;
  user: string;
}

export interface AnalysisJobDependencies {
  /** Wraps `POST engine/analyze-game` (architecture §4). */
  analyzeGamePositions: (fens: string[]) => Promise<EngineEval[]>;
  /** Wraps the gateway's light-tier model call. The model is constrained to
   * CoachingPlanSchema by the provider, so this yields an already-valid plan
   * or throws — LLM output never reaches the DB unvalidated. */
  callPlanner: (messages: PlannerMessages) => Promise<CoachingPlan>;
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
    const evals = await analyzeInChunks(db, deps, analysis.id, fens);

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
    const plan = await generatePlan(deps, plannerInput);

    await analysesRepo.markReady(db, analysis.id, plan);
  } catch (error) {
    await analysesRepo.markFailed(db, analysis.id, describeError(error));
  }
}

/**
 * Analyzes the game a chunk at a time, persisting what's done after each one.
 *
 * The evals are identical either way — this exists so the wait is legible.
 * `engine_running` is by far the longest step (tens of seconds; longer still
 * in browser mode, where a real game measured ~42s), and analyzing in one
 * call meant nothing observable happened until all of it finished. Writing
 * each chunk lets GET /api/analyses/:id/status report how many positions are
 * done, which is what drives the percentage on the progress screen.
 *
 * Deliberately at this layer rather than in either EngineBackend, so native
 * and browser mode report progress the same way.
 */
async function analyzeInChunks(
  db: Kysely<Database>,
  deps: AnalysisJobDependencies,
  analysisId: string,
  fens: string[]
): Promise<EngineEval[]> {
  const evals: EngineEval[] = [];

  for (let start = 0; start < fens.length; start += ENGINE_CHUNK_POSITIONS) {
    const chunk = fens.slice(start, start + ENGINE_CHUNK_POSITIONS);
    evals.push(...(await deps.analyzeGamePositions(chunk)));
    await analysesRepo.storeEngineEvals(db, analysisId, evals);
  }

  // An empty game would otherwise never write the (empty) evals at all.
  if (fens.length === 0) await analysesRepo.storeEngineEvals(db, analysisId, evals);

  return evals;
}

async function generatePlan(deps: AnalysisJobDependencies, input: PlannerPromptInput): Promise<CoachingPlan> {
  return deps.callPlanner(buildPlannerMessages(input));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
