import type { Kysely } from 'kysely';
import type { UpdateUserProfileRequest, UserProfile } from '@chess-coach/shared';
import * as creditsRepo from '../db/repositories/credits.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';

export interface Identity {
  email: string;
  displayName: string;
}

/** Finds the user by email, or creates them with a one-time 100-credit signup
 * grant (inserted atomically with the user row). Safe to call on every request. */
export async function getOrCreate(
  db: Kysely<Database>,
  identity: Identity
): Promise<usersRepo.UserRow> {
  const existing = await usersRepo.findByEmail(db, identity.email);
  if (existing) return existing;

  return db.transaction().execute(async (trx) => {
    const user = await usersRepo.insert(trx, identity);
    await creditsRepo.insertSignupGrant(trx, user.id);
    return user;
  });
}

export function updateProfile(
  db: Kysely<Database>,
  userId: string,
  patch: UpdateUserProfileRequest
): Promise<usersRepo.UserRow> {
  return usersRepo.update(db, userId, patch);
}

export async function toUserProfile(
  db: Kysely<Database>,
  user: usersRepo.UserRow
): Promise<UserProfile> {
  const creditBalance = await creditsRepo.balance(db, user.id);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    ratingBand: user.ratingBand,
    lichessUsername: user.lichessUsername,
    chesscomUsername: user.chesscomUsername,
    selfAssessment: user.selfAssessment,
    creditBalance
  };
}
