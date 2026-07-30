import { CREDIT_PACK_CREDITS, CreateCheckoutSessionRequestSchema } from '@chess-coach/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { ValidationError } from '../lib/errors.js';
import type { StripeClient } from '../services/stripe.js';
import * as userProfileService from '../services/user-profile.js';

export function registerCreditsRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  stripeClient: StripeClient
): void {
  app.post('/api/credits/checkout', async (request) => {
    const parsed = CreateCheckoutSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const user = await userProfileService.getOrCreate(db, request.user);
    const credits = CREDIT_PACK_CREDITS[parsed.data.pack];
    return stripeClient.createCheckoutSession({ pack: parsed.data.pack, userId: user.id, credits });
  });
}
