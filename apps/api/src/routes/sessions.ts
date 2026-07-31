import { CreateSessionRequestSchema, PostSessionMessageRequestSchema } from '@chess-coach/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import * as coachAgent from '../services/coach-agent.js';
import * as userProfileService from '../services/user-profile.js';
import type { CoachAgentDependencies } from '../services/coach-agent.js';

export function registerSessionsRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  agentDeps: CoachAgentDependencies
): void {
  app.post('/api/sessions', async (request) => {
    const parsed = CreateSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const user = await userProfileService.getOrCreate(db, request.user);
    const game = await gamesRepo.findByIdForUser(db, parsed.data.gameId, user.id);
    if (!game) throw new NotFoundError('Game not found');

    const analysis = await analysesRepo.findByGameId(db, game.id);
    if (!analysis || analysis.status !== 'ready') {
      throw new ConflictError('Analysis is not ready yet');
    }

    return coachAgent.resumeOrCreateSession(db, user.id, game.id);
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    const detail = await coachAgent.getSessionDetail(db, request.params.id, user.id);
    if (!detail) throw new NotFoundError('Session not found');
    return detail;
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/reset', async (request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    return coachAgent.resetSession(db, user.id, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/messages', async (request, reply) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    const session = await sessionsRepo.findByIdForUser(db, request.params.id, user.id);
    if (!session) throw new NotFoundError('Session not found');

    const parsed = PostSessionMessageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const streamResult = await coachAgent.startTurn(agentDeps, session, parsed.data);

    reply.hijack();
    streamResult.pipeDataStreamToResponse(reply.raw, {
      getErrorMessage: (error) => {
        console.error('coach stream error:', error);
        return 'An error occurred.';
      }
    });
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id/debug/last-turn', async (request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    const session = await sessionsRepo.findByIdForUser(db, request.params.id, user.id);
    if (!session) throw new NotFoundError('Session not found');

    const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
    if (!snapshot) throw new NotFoundError('No completed turn to debug yet');
    return snapshot;
  });
}
