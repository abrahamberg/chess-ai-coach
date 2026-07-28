import { ThreadSchema, type Thread } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { ValidationError } from '../lib/errors.js';

const MAX_THREADS = 8;
const MAX_ACTIVE_THREADS = 1;

export interface ThreadsService {
  replace(sessionId: string, threads: Thread[]): Promise<Thread[]>;
}

/** update_threads tool (architecture §7.1/§7.5): full-replace of a session's
 * backstage conversation-thread ledger. The system enforces the shape/size
 * limits here, not the LLM — a well-behaved model should never hit them, but
 * they're the actual guarantee. */
export function createThreadsService(db: Kysely<Database>): ThreadsService {
  return {
    async replace(sessionId, threads) {
      const parsed = ThreadSchema.array().safeParse(threads);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
      }
      if (parsed.data.length > MAX_THREADS) {
        throw new ValidationError(`Too many threads: ${parsed.data.length} (max ${MAX_THREADS})`);
      }
      const activeCount = parsed.data.filter((thread) => thread.status === 'active').length;
      if (activeCount > MAX_ACTIVE_THREADS) {
        throw new ValidationError(`Too many active threads: ${activeCount} (max ${MAX_ACTIVE_THREADS})`);
      }

      await sessionsRepo.updateThreads(db, sessionId, parsed.data);
      return parsed.data;
    }
  };
}
