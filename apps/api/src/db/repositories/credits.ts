import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export async function balance(db: Kysely<Database>, userId: string): Promise<number> {
  const result = await db
    .selectFrom('creditLedger')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('delta'), eb.val(0)).as('total'))
    .where('userId', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(result.total);
}

export function insertSignupGrant(db: Kysely<Database>, userId: string): Promise<void> {
  return db
    .insertInto('creditLedger')
    .values({ userId, delta: 100, reason: 'signup_grant' })
    .execute()
    .then(() => undefined);
}

/** Grants purchased credits (specs.md F6.3). `stripeEventId` carries the Stripe
 * event id and is UNIQUE on `credit_ledger` — the ON CONFLICT DO NOTHING makes a
 * webhook replay of the same event a safe no-op instead of double-crediting. */
export function insertPurchase(
  db: Kysely<Database>,
  userId: string,
  credits: number,
  stripeEventId: string
): Promise<void> {
  return db
    .insertInto('creditLedger')
    .values({ userId, delta: credits, reason: 'purchase', stripeEventId })
    .onConflict((oc) => oc.column('stripeEventId').doNothing())
    .execute()
    .then(() => undefined);
}

export function insertUsageDebit(
  db: Kysely<Database>,
  userId: string,
  sessionId: string | null,
  credits: number
): Promise<void> {
  return db
    .insertInto('creditLedger')
    .values({ userId, delta: -credits, reason: 'session_usage', sessionId })
    .execute()
    .then(() => undefined);
}

export interface NewLlmCallLog {
  userId: string;
  sessionId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  creditsMetered: number;
  purpose: string;
}

export function insertCallLog(db: Kysely<Database>, values: NewLlmCallLog): Promise<void> {
  return db
    .insertInto('llmCallLog')
    .values(values)
    .execute()
    .then(() => undefined);
}
