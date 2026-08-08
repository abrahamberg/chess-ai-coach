import {
  CommitPlayerMoveRequestSchema,
  CreatePlaySessionRequestSchema,
  CreateSessionRequestSchema,
  PostSessionMessageRequestSchema
} from '@chess-coach/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import type { CoachAgentBaseDependencies } from '../bootstrap.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { pipeCoachStreamToResponse } from '../llm/stream-response.js';
import * as coachAgent from '../services/coach-agent.js';
import { commitPlayerMoveAndAdvance } from '../services/play-move-commit.js';
import { createPlaySession } from '../services/play-session.js';
import * as userProfileService from '../services/user-profile.js';
import type { CoachAgentDependencies } from '../services/coach-agent.js';
import { resolveEngineBackend, type ResolveEngineBackendOptions } from '../services/engine/resolve-engine-backend.js';

export function registerSessionsRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  baseDeps: CoachAgentBaseDependencies,
  engineBackendOptions: ResolveEngineBackendOptions
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

  // architecture §14: no credits/analysis gate — a play-mode game has no
  // pre-session analysis pipeline to wait on.
  app.post('/api/sessions/play', async (request) => {
    const parsed = CreatePlaySessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const user = await userProfileService.getOrCreate(db, request.user);
    return createPlaySession(db, user.id, parsed.data.studentColor);
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

    const agentDeps = await buildRequestScopedAgentDeps(baseDeps, engineBackendOptions, user.id);
    const turn = await coachAgent.startTurn(agentDeps, session, parsed.data);

    reply.hijack();
    void pipeCoachStreamToResponse(reply.raw, turn);
  });

  // architecture §14: plain JSON, not the SSE chat endpoint above — the
  // frontend needs the confirmed fen immediately, independent of whether/
  // when the follow-up chat turn runs. No standalone undo route exists:
  // undo is only ever reached via the undo_last_move coach tool, mediated
  // by conversation ("the coach asks, the student agrees").
  app.post<{ Params: { id: string } }>('/api/sessions/:id/play-move', async (request, reply) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    const session = await sessionsRepo.findByIdForUser(db, request.params.id, user.id);
    if (!session) throw new NotFoundError('Session not found');
    if (session.mode !== 'play') throw new ConflictError('Session is not a play-mode session');
    if (session.status !== 'active') throw new ConflictError('Session is not active');

    const parsed = CommitPlayerMoveRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const agentDeps = await buildRequestScopedAgentDeps(baseDeps, engineBackendOptions, user.id);
    const result = await commitPlayerMoveAndAdvance(agentDeps, session, parsed.data.san);
    if ('error' in result) return sendIllegalMoveError(reply, result.error);
    return result;
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

async function buildRequestScopedAgentDeps(
  base: CoachAgentBaseDependencies,
  engineBackendOptions: ResolveEngineBackendOptions,
  userId: string
): Promise<CoachAgentDependencies> {
  const backend = await resolveEngineBackend(engineBackendOptions, userId);
  return { ...base, analyzePosition: (fen) => backend.analyzePosition(fen) };
}

/** Same application/problem+json 422 shape games.ts's handleImportError uses
 * for a syntactically-valid request that fails a chess-domain rule. */
function sendIllegalMoveError(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(422).type('application/problem+json').send({
    type: 'about:blank',
    title: message,
    status: 422
  });
}
