import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { ValidationError } from '../lib/errors.js';
import { createCreditsService } from '../services/credits.js';
import type { StripeClient, StripeWebhookEvent } from '../services/stripe.js';

const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

/** Registered in its own encapsulation context so only `/api/stripe/webhook`
 * gets a raw (Buffer) body parser — `stripe.webhooks.constructEvent` verifies
 * the exact bytes Stripe signed, and Fastify's default JSON parser would have
 * already consumed/reserialized the body by the time a normal handler runs.
 * Every other route keeps the default JSON parsing (see stripe-webhook.test.ts
 * for the check that this doesn't leak into the rest of the app). */
export function registerStripeWebhookRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  stripeClient: StripeClient
): void {
  const creditsService = createCreditsService(db);

  app.register(async (instance) => {
    instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    instance.post('/api/stripe/webhook', async (request) => {
      const signature = request.headers[STRIPE_SIGNATURE_HEADER];
      if (typeof signature !== 'string') {
        throw new ValidationError('Missing stripe-signature header');
      }

      const event = parseEvent(stripeClient, request.body as Buffer, signature);
      if (event.type === 'checkout_completed') {
        await creditsService.grantPurchase({
          userId: event.userId,
          credits: event.credits,
          stripeEventId: event.stripeEventId
        });
      }
      return { received: true };
    });
  });
}

function parseEvent(stripeClient: StripeClient, payload: Buffer, signature: string): StripeWebhookEvent {
  try {
    return stripeClient.parseWebhookEvent(payload, signature);
  } catch (error) {
    throw new ValidationError(`Invalid Stripe webhook signature: ${(error as Error).message}`);
  }
}
