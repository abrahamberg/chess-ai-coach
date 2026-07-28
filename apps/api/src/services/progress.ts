import { MISTAKE_CATEGORIES } from '@chess-coach/shared';
import type { Finding, FocusAreaUpdate, MistakeCategory } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as findingsRepo from '../db/repositories/findings.js';
import * as focusAreasRepo from '../db/repositories/focus-areas.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { ValidationError } from '../lib/errors.js';

const MAX_ACTIVE_FOCUS_AREAS = 3;

/** end_session tool: marks the session completed. Summarize-session job
 * enqueueing is the caller's responsibility (needs the JobQueue). */
export function completeSession(db: Kysely<Database>, sessionId: string): Promise<void> {
  return sessionsRepo.markCompleted(db, sessionId);
}

export async function recordFinding(
  db: Kysely<Database>,
  userId: string,
  sessionId: string | null,
  gameId: string | null,
  finding: Finding
): Promise<findingsRepo.FindingRow> {
  assertValidCategory(finding.category);
  return findingsRepo.insert(db, {
    userId,
    sessionId,
    gameId,
    category: finding.category,
    severity: finding.severity,
    ply: finding.ply,
    description: finding.description,
    isPositive: finding.isPositive
  });
}

export interface FocusAreaUpdateResult {
  applied: boolean;
  focusArea?: focusAreasRepo.FocusAreaRow;
}

/**
 * The max-3-active cap and category validation live here (architecture §7.1):
 * a 'create' beyond the cap is silently not inserted ("queued" per prompts.md
 * §5.1 — the LLM ranked it, but the system enforces the limit, not an error).
 */
export async function applyFocusAreaUpdate(
  db: Kysely<Database>,
  userId: string,
  update: FocusAreaUpdate
): Promise<FocusAreaUpdateResult> {
  assertValidCategory(update.category);

  const existing = await focusAreasRepo.findByUserAndCategory(db, userId, update.category);

  if (update.action === 'create') {
    return applyCreate(db, userId, update, existing);
  }
  if (!existing) return { applied: false };

  const focusArea = await focusAreasRepo.updateStatusAndNote(
    db,
    existing.id,
    nextStatusFor(update.action, existing.status),
    update.note
  );
  return { applied: true, focusArea };
}

async function applyCreate(
  db: Kysely<Database>,
  userId: string,
  update: FocusAreaUpdate,
  existing: focusAreasRepo.FocusAreaRow | undefined
): Promise<FocusAreaUpdateResult> {
  if (existing) return { applied: false };

  const activeCount = await focusAreasRepo.countActiveByUser(db, userId);
  if (activeCount >= MAX_ACTIVE_FOCUS_AREAS) return { applied: false };

  const focusArea = await focusAreasRepo.insert(db, {
    userId,
    category: update.category,
    status: 'active',
    note: update.note
  });
  return { applied: true, focusArea };
}

function nextStatusFor(
  action: 'progress' | 'regress' | 'resolve',
  current: focusAreasRepo.FocusAreaStatus
): focusAreasRepo.FocusAreaStatus {
  if (action === 'resolve') return 'resolved';
  if (action === 'regress') return 'active';
  return current === 'resolved' ? 'resolved' : 'improving';
}

function assertValidCategory(category: string): asserts category is MistakeCategory {
  if (!(MISTAKE_CATEGORIES as readonly string[]).includes(category)) {
    throw new ValidationError(`Unknown mistake category: ${category}`);
  }
}
