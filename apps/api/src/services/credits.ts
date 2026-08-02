import type { Kysely } from 'kysely';
import * as creditsRepo from '../db/repositories/credits.js';
import type { Database } from '../db/schema.js';
import { InsufficientCreditsError } from '../lib/errors.js';

export interface GrantPurchaseParams {
  userId: string;
  credits: number;
  /** Stripe event id — the ledger's UNIQUE constraint makes granting twice for
   * the same id a no-op, which is how webhook replays stay safe (F6.3). */
  stripeEventId: string;
}

export interface CreditsService {
  balance(userId: string): Promise<number>;
  assertCanSpend(userId: string): Promise<void>;
  grantPurchase(params: GrantPurchaseParams): Promise<void>;
}

export function createCreditsService(db: Kysely<Database>): CreditsService {
  return {
    balance: (userId) => creditsRepo.balance(db, userId),
    async assertCanSpend(userId) {
      const currentBalance = await creditsRepo.balance(db, userId);
      if (currentBalance <= 0) {
        throw new InsufficientCreditsError('Insufficient credits');
      }
    },
    grantPurchase: (params) =>
      creditsRepo.insertPurchase(db, params.userId, params.credits, params.stripeEventId)
  };
}
