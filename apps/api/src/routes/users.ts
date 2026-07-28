import { UpdateUserProfileRequestSchema } from '@chess-coach/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { ValidationError } from '../lib/errors.js';
import * as userProfileService from '../services/user-profile.js';
import type { Database } from '../db/schema.js';

export function registerUsersRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/api/users/me', async (request) => {
    const user = await userProfileService.getOrCreate(db, request.user);
    return userProfileService.toUserProfile(db, user);
  });

  app.patch('/api/users/me', async (request) => {
    const parsed = UpdateUserProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const user = await userProfileService.getOrCreate(db, request.user);
    const updated = await userProfileService.updateProfile(db, user.id, parsed.data);
    return userProfileService.toUserProfile(db, updated);
  });
}
