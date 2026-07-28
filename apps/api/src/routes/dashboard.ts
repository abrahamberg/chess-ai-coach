import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { getDashboard } from '../services/dashboard.js';
import * as userProfileService from '../services/user-profile.js';

export function registerDashboardRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/api/users/me/dashboard', async (request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    return getDashboard(db, user.id);
  });
}
