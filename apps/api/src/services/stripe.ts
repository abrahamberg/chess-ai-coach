import Stripe from 'stripe';
import type { CreditPack } from '@chess-coach/shared';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Real Stripe Price ids per pack, from env (STRIPE_PRICE_SMALL/MEDIUM/LARGE) —
   * never hardcoded (architecture: prices are config, not literals in code). */
  priceIds: Record<CreditPack, string>;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionParams {
  pack: CreditPack;
  userId: string;
  /** specs.md F6.3 pack size — carried as Checkout Session metadata so the
   * webhook can credit the ledger without re-deriving it from the price id. */
  credits: number;
}

/** A `checkout.session.completed` event, already verified and parsed down to
 * the one thing the credits webhook cares about. Every other event type comes
 * back as `ignored` so the route can 200 without acting on it. */
export type StripeWebhookEvent =
  | { type: 'checkout_completed'; stripeEventId: string; userId: string; credits: number }
  | { type: 'ignored' };

export interface StripeClient {
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<{ url: string }>;
  /** Verifies the webhook signature (throws if invalid) and parses the event.
   * `payload` must be the raw request body bytes — Stripe signs the exact bytes
   * sent, so a JSON-parsed-then-restringified body will fail verification. */
  parseWebhookEvent(payload: Buffer, signature: string): StripeWebhookEvent;
}

/** Thin wrapper around the Stripe SDK (mirrors llm/gateway.ts's provider
 * wrappers: no other file talks to the `stripe` package directly). */
export function createStripeClient(config: StripeConfig): StripeClient {
  const stripe = new Stripe(config.secretKey);

  return {
    async createCheckoutSession({ pack, userId, credits }) {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: config.priceIds[pack], quantity: 1 }],
        success_url: config.successUrl,
        cancel_url: config.cancelUrl,
        metadata: { userId, credits: String(credits) }
      });
      if (!session.url) throw new Error('Stripe checkout session response is missing a url');
      return { url: session.url };
    },
    parseWebhookEvent(payload, signature) {
      const event = stripe.webhooks.constructEvent(payload, signature, config.webhookSecret);
      return toWebhookEvent(event);
    }
  };
}

/** Exported for direct unit testing (stripe.test.ts) — the branching/parsing
 * logic here (event-type narrowing, metadata extraction, NaN handling) is the
 * one piece of real logic in this file and isn't exercised by route tests that
 * mock `StripeClient.parseWebhookEvent` at the interface boundary. */
export function toWebhookEvent(event: Stripe.Event): StripeWebhookEvent {
  if (event.type !== 'checkout.session.completed') return { type: 'ignored' };

  const session = event.data.object;
  const userId = session.metadata?.userId;
  const creditsRaw = session.metadata?.credits;
  const credits = creditsRaw !== undefined ? Number(creditsRaw) : NaN;
  if (!userId || !Number.isFinite(credits)) {
    throw new Error('checkout.session.completed event is missing userId/credits metadata');
  }

  return { type: 'checkout_completed', stripeEventId: event.id, userId, credits };
}
