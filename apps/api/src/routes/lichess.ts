import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import type { LichessClient } from '../services/lichess.js';
import * as userProfileService from '../services/user-profile.js';

export function registerLichessRoutes(app: FastifyInstance, db: Kysely<Database>, lichessClient: LichessClient): void {
  app.get('/api/lichess/recent-games', async (request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    if (!user.lichessUsername) {
      throw new NotFoundError('No linked Lichess username');
    }
    return lichessClient.fetchRecentGames(user.lichessUsername);
  });
}
