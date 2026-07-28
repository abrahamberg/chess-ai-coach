import type { Kysely } from 'kysely';
import * as creditsRepo from '../db/repositories/credits.js';
import type { Database } from '../db/schema.js';
import { InsufficientCreditsError } from '../lib/errors.js';

export interface CreditsService {
  balance(userId: string): Promise<number>;
  assertCanSpend(userId: string): Promise<void>;
}

export function createCreditsService(db: Kysely<Database>): CreditsService {
  return {
    balance: (userId) => creditsRepo.balance(db, userId),
    async assertCanSpend(userId) {
      const currentBalance = await creditsRepo.balance(db, userId);
      if (currentBalance <= 0) {
        throw new InsufficientCreditsError('Insufficient credits');
      }
    }
  };
}
