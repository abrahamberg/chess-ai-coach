import { parsePgn } from '@chess-coach/chess-analysis';
import type { PositionAnalysis } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as gamesRepo from '../db/repositories/games.js';
import * as positionEvaluationsRepo from '../db/repositories/position-evaluations.js';
import type { Database } from '../db/schema.js';

export interface DeepenAnalysisJobDependencies {
  /** Wraps `POST engine/analyze-position` (architecture §4). */
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
}

/** How many newly-computed positions accumulate before a batch DB write —
 * a durability checkpoint (a crash mid-job doesn't lose everything already
 * computed) and a way to keep write volume low on long games. */
const BATCH_SIZE = 10;

/**
 * Follow-up pass after the fast classify/plan pipeline (runAnalyzeGameJob,
 * services/analysis.ts): walks every ply of the game, skipping positions
 * position_evaluations already has cached (from this game or any other —
 * the table is keyed by fen alone), computes the rest via Stockfish, and
 * persists them in batches of BATCH_SIZE. Purely additive — never touches
 * analyses/classifiedMoves/the coaching plan, so a failure here can't
 * regress the fast pipeline's output.
 *
 * Each batch is computed concurrently (Promise.all), not one position at a
 * time — the engine service pools multiple Stockfish processes
 * (services/engine/src/engine-pool.ts), so a strictly sequential walk here
 * left half that capacity idle and made a full game take far longer to
 * finish than the pool could actually support. The batch write after each
 * chunk is still the durability checkpoint (a crash mid-job only redoes the
 * current in-flight batch, not the whole game).
 */
export async function runDeepenAnalysisJob(
  db: Kysely<Database>,
  deps: DeepenAnalysisJobDependencies,
  gameId: string
): Promise<void> {
  const game = await gamesRepo.findById(db, gameId);
  if (!game) throw new Error(`Game ${gameId} not found`);

  const fens = parsePgn(game.pgn).positions.map((position) => position.fen);
  // This job is always server-side (native engine HTTP call) — the
  // browser-tunnel path isn't wired through here yet (later task), so both
  // the read and the write below are always native-trust.
  const cached = await positionEvaluationsRepo.findManyByFens(db, fens, { allowExternal: false });
  const uncachedFens = fens.filter((fen) => !cached.has(fen));

  console.log(
    `deepen-analysis: game ${gameId} — ${fens.length} plies, ${cached.size} already cached, ${uncachedFens.length} to compute`
  );

  let computed = 0;
  for (let i = 0; i < uncachedFens.length; i += BATCH_SIZE) {
    const chunk = uncachedFens.slice(i, i + BATCH_SIZE);
    const entries = await Promise.all(
      chunk.map(async (fen) => {
        const analysis = await deps.analyzePosition(fen);
        return { fen, depth: analysis.depth, multiPv: analysis.multiPv, analysis };
      })
    );
    await positionEvaluationsRepo.upsertMany(db, entries, { isExternalEval: false });
    computed += entries.length;
    console.log(`deepen-analysis: game ${gameId} — ${computed}/${uncachedFens.length} positions cached`);
  }

  console.log(`deepen-analysis: game ${gameId} — done`);
}
