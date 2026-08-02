import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildApp } from '../app.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { createCreditsService } from '../services/credits.js';
import type { StripeClient, StripeWebhookEvent } from '../services/stripe.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';

describe('POST /api/stripe/webhook', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  const webhookHeaders = { 'stripe-signature': 'sig_whatever', 'content-type': 'application/json' };

  function makeStripeClient(parseWebhookEvent: StripeClient['parseWebhookEvent']): StripeClient {
    return {
      createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_123' }),
      parseWebhookEvent
    };
  }

  async function makeUser(email: string): Promise<string> {
    const user = await usersRepo.insert(db, { email, displayName: email });
    return user.id;
  }

  test('an invalid signature is rejected as 400', async () => {
    const stripeClient = makeStripeClient(
      vi.fn(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      })
    );
    const app = buildApp({ authMode: 'proxy', db, stripeClient });

    const response = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: webhookHeaders,
      payload: JSON.stringify({ id: 'evt_bad_signature' })
    });

    expect(response.statusCode).toBe(400);
  });

  test('a valid checkout.session.completed event credits the ledger', async () => {
    const userId = await makeUser('webhook-valid@example.com');
    const event: StripeWebhookEvent = {
      type: 'checkout_completed',
      stripeEventId: 'evt_valid_1',
      userId,
      credits: 1000
    };
    const stripeClient = makeStripeClient(vi.fn().mockReturnValue(event));
    const app = buildApp({ authMode: 'proxy', db, stripeClient });

    const response = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: webhookHeaders,
      payload: JSON.stringify({ id: 'evt_valid_1' })
    });

    expect(response.statusCode).toBe(200);
    const creditsService = createCreditsService(db);
    expect(await creditsService.balance(userId)).toBe(1000);
  });

  test('replaying the same event id only credits the ledger once', async () => {
    const userId = await makeUser('webhook-replay@example.com');
    const event: StripeWebhookEvent = {
      type: 'checkout_completed',
      stripeEventId: 'evt_replay_1',
      userId,
      credits: 300
    };
    const stripeClient = makeStripeClient(vi.fn().mockReturnValue(event));
    const app = buildApp({ authMode: 'proxy', db, stripeClient });

    const first = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: webhookHeaders,
      payload: JSON.stringify({ id: 'evt_replay_1' })
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: webhookHeaders,
      payload: JSON.stringify({ id: 'evt_replay_1' })
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const creditsService = createCreditsService(db);
    expect(await creditsService.balance(userId)).toBe(300);
  });

  test('an event type other than checkout.session.completed is accepted and ignored', async () => {
    const stripeClient = makeStripeClient(vi.fn().mockReturnValue({ type: 'ignored' } satisfies StripeWebhookEvent));
    const app = buildApp({ authMode: 'proxy', db, stripeClient });

    const response = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: webhookHeaders,
      payload: JSON.stringify({ id: 'evt_other' })
    });

    expect(response.statusCode).toBe(200);
  });

  test('registering the raw-body webhook route does not break normal JSON parsing on other routes', async () => {
    const stripeClient = makeStripeClient(vi.fn());
    const app = buildApp({ authMode: 'proxy', db, stripeClient });

    const response = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      headers: { 'x-auth-request-email': 'json-unaffected@example.com', 'x-auth-request-user': 'Json' },
      payload: { pack: 'small' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ url: 'https://checkout.stripe.com/pay/cs_test_123' });
  });
});
