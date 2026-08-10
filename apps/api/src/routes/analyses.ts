import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import type { Database } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import * as userProfileService from '../services/user-profile.js';

const TERMINAL_STATUSES = new Set(['ready', 'failed']);

export function registerAnalysesRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  pollIntervalMs: number
): void {
  app.get<{ Params: { id: string } }>('/api/analyses/:id/status', async (request, reply) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    const analysis = await analysesRepo.findByIdForUser(db, request.params.id, user.id);
    if (!analysis) throw new NotFoundError('Analysis not found');

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    await streamStatusUntilTerminal(db, request.params.id, reply.raw, pollIntervalMs);
  });
}

function streamStatusUntilTerminal(
  db: Kysely<Database>,
  analysisId: string,
  raw: { write: (chunk: string) => void; end: () => void },
  pollIntervalMs: number
): Promise<void> {
  return new Promise((resolve) => {
    let lastStatus: string | null = null;
    let lastAnalyzedPositions = -1;

    const tick = async () => {
      const analysis = await analysesRepo.findProgress(db, analysisId);
      const status = analysis?.status ?? null;
      // services/analysis.ts persists engine evals a chunk at a time, so their
      // stored count is how far the engine step has actually got. The client
      // already knows the game's ply count (it holds the PGN) and turns the
      // two into a percentage — no schema change needed to carry progress.
      const analyzedPositions = analysis?.progress ?? 0;

      // Emitted on progress as well as status: `engine_running` covers the
      // whole engine pass, so without this the longest step reports nothing.
      if (status !== null && (status !== lastStatus || analyzedPositions !== lastAnalyzedPositions)) {
        lastStatus = status;
        lastAnalyzedPositions = analyzedPositions;
        raw.write(`data: ${JSON.stringify({ status, analyzedPositions })}\n\n`);
      }

      if (status === null || TERMINAL_STATUSES.has(status)) {
        raw.end();
        resolve();
        return;
      }

      setTimeout(() => void tick(), pollIntervalMs);
    };

    void tick();
  });
}
