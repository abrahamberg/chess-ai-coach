import type Stripe from 'stripe';
import { describe, expect, test } from 'vitest';
import { toWebhookEvent } from './stripe.js';

/** Builds a minimal object shaped like the one piece of a Stripe.Event this
 * function actually reads (id, type, data.object.metadata) — casting the rest
 * away rather than constructing the full Stripe SDK type, the same fixture
 * style used elsewhere in this codebase for external-SDK response shapes. */
function checkoutSessionCompletedEvent(metadata: Record<string, string>): Stripe.Event {
  return {
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    data: { object: { metadata } }
  } as unknown as Stripe.Event;
}

describe('toWebhookEvent', () => {
  test('a checkout.session.completed event with well-formed metadata parses to checkout_completed', () => {
    const event = checkoutSessionCompletedEvent({ userId: 'user-123', credits: '1000' });

    expect(toWebhookEvent(event)).toEqual({
      type: 'checkout_completed',
      stripeEventId: 'evt_test_1',
      userId: 'user-123',
      credits: 1000
    });
  });

  test('throws when userId is missing from metadata', () => {
    const event = checkoutSessionCompletedEvent({ credits: '1000' });

    expect(() => toWebhookEvent(event)).toThrow(/userId\/credits metadata/);
  });

  test('throws when credits is missing from metadata', () => {
    const event = checkoutSessionCompletedEvent({ userId: 'user-123' });

    expect(() => toWebhookEvent(event)).toThrow(/userId\/credits metadata/);
  });

  test('throws when credits is not a finite number (the NaN edge case)', () => {
    const event = checkoutSessionCompletedEvent({ userId: 'user-123', credits: 'not-a-number' });

    expect(() => toWebhookEvent(event)).toThrow(/userId\/credits metadata/);
  });

  test('an event type other than checkout.session.completed is ignored, not parsed', () => {
    const event = { id: 'evt_test_2', type: 'payment_intent.succeeded', data: { object: {} } } as unknown as Stripe.Event;

    expect(toWebhookEvent(event)).toEqual({ type: 'ignored' });
  });
});
