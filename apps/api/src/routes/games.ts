import { InvalidPgnError } from '@chess-coach/chess-analysis';
import { ImportGameRequestSchema } from '@chess-coach/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import type { Database } from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { importGame, MissingUserColorError } from '../services/game-import.js';
import { listGamesForUser } from '../services/games.js';
import * as userProfileService from '../services/user-profile.js';

export function registerGamesRoutes(app: FastifyInstance, db: Kysely<Database>, jobQueue: JobQueue): void {
  app.post('/api/games', async (request, reply) => {
    const parsed = ImportGameRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const user = await userProfileService.getOrCreate(db, request.user);
    const usernames = {
      lichess: user.lichessUsername ?? undefined,
      chesscom: user.chesscomUsername ?? undefined,
      displayName: user.displayName
    };

    try {
      return await importGame(db, jobQueue, user.id, usernames, parsed.data);
    } catch (error) {
      return handleImportError(reply, error);
    }
  });

  app.get('/api/games', async (request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    return listGamesForUser(db, user.id);
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    const game = await gamesRepo.findByIdForUser(db, request.params.id, user.id);
    if (!game) throw new NotFoundError('Game not found');

    const analysis = await analysesRepo.findByGameId(db, game.id);
    const classifiedMoves = await analysesRepo.findClassifiedMovesByGameId(db, game.id);
    return { ...game, analysisStatus: analysis?.status ?? null, classifiedMoves: classifiedMoves ?? null };
  });
}

function handleImportError(reply: FastifyReply, error: unknown): FastifyReply | never {
  if (error instanceof InvalidPgnError) throw new ValidationError(error.message);
  if (error instanceof MissingUserColorError) {
    return reply.code(422).type('application/problem+json').send({
      type: 'about:blank',
      title: error.message,
      status: 422,
      missing: 'userColor'
    });
  }
  throw error;
}
