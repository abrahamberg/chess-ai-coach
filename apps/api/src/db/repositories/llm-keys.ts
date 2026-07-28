import type { Kysely } from 'kysely';
import type { LlmProvider } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export interface LlmKeyRow {
  userId: string;
  provider: LlmProvider;
  keyCiphertext: Buffer;
  keyIv: Buffer;
  createdAt: Date;
}

export function upsert(
  db: Kysely<Database>,
  userId: string,
  provider: LlmProvider,
  keyCiphertext: Buffer,
  keyIv: Buffer
): Promise<void> {
  return db
    .insertInto('userLlmKeys')
    .values({ userId, provider, keyCiphertext, keyIv })
    .onConflict((oc) => oc.columns(['userId', 'provider']).doUpdateSet({ keyCiphertext, keyIv }))
    .execute()
    .then(() => undefined);
}

export function remove(db: Kysely<Database>, userId: string, provider: LlmProvider): Promise<void> {
  return db
    .deleteFrom('userLlmKeys')
    .where('userId', '=', userId)
    .where('provider', '=', provider)
    .execute()
    .then(() => undefined);
}

export function findAllByUser(db: Kysely<Database>, userId: string): Promise<LlmKeyRow[]> {
  return db.selectFrom('userLlmKeys').selectAll().where('userId', '=', userId).execute();
}
