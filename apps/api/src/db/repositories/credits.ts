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
