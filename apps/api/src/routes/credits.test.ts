import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { Database } from '../db/schema.js';
import type { StripeClient } from '../services/stripe.js';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';

describe('POST /api/credits/checkout', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  const headers = { 'x-auth-request-email': 'checkout@example.com', 'x-auth-request-user': 'Checkout' };

  function makeStripeClient(): StripeClient {
    return {
      createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_123' }),
      parseWebhookEvent: vi.fn()
    };
  }

  test.each([
    ['small', 300],
    ['medium', 1000],
    ['large', 3000]
  ] as const)('pack=%s returns a checkout session URL with the right metadata', async (pack, credits) => {
    const stripeClient = makeStripeClient();
    const app = buildApp({ authMode: 'proxy', db, stripeClient });

    const response = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      headers,
      payload: { pack }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ url: 'https://checkout.stripe.com/pay/cs_test_123' });

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', 'checkout@example.com')
      .executeTakeFirstOrThrow();
    expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith({ pack, userId: user.id, credits });
  });

  test('rejects an unknown pack as 400', async () => {
    const stripeClient = makeStripeClient();
    const app = buildApp({ authMode: 'proxy', db, stripeClient });

    const response = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      headers,
      payload: { pack: 'giant' }
    });

    expect(response.statusCode).toBe(400);
    expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
  });
});
