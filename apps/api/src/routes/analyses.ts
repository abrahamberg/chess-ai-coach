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

    const tick = async () => {
      const analysis = await analysesRepo.findById(db, analysisId);
      const status = analysis?.status ?? null;

      if (status !== lastStatus && status !== null) {
        lastStatus = status;
        raw.write(`data: ${JSON.stringify({ status })}\n\n`);
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
