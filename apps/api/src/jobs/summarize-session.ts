import { buildSummarizerMessages } from '@chess-coach/prompts';
import { SessionOutcomeSchema } from '@chess-coach/shared';
import type { Task } from 'graphile-worker';
import type { Kysely } from 'kysely';
import * as findingsRepo from '../db/repositories/findings.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import type { SessionMessageRow } from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as usersRepo from '../db/repositories/users.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import type { Database } from '../db/schema.js';
import { getModelForUser, recordUsage, type GatewayConfig } from '../llm/gateway.js';
import { generateStructured } from '../llm/text.js';
import { toBillableTokens } from '../llm/usage.js';
import { applySessionOutcome } from '../services/progress.js';
import * as userProfileService from '../services/user-profile.js';

export interface SummarizeSessionJobPayload {
  sessionId: string;
}

export interface SummarizeSessionTaskOptions {
  db: Kysely<Database>;
  gatewayConfig: GatewayConfig;
}

/** graphile-worker Task for the post-session progress summary (architecture §5,
 * prompts.md §5): light-tier call, validated against SessionOutcomeSchema, applied
 * via services/progress.ts (dedup + focus-area state machine + summary storage). */
export function createSummarizeSessionTask(options: SummarizeSessionTaskOptions): Task {
  return async (payload) => {
    const { sessionId } = payload as SummarizeSessionJobPayload;
    const session = await sessionsRepo.findById(options.db, sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const [user, plan, profileSummary, priorFindings, transcriptMessages] = await Promise.all([
      usersRepo.findById(options.db, session.userId),
      analysesRepo.findCoachingPlanByGameId(options.db, session.gameId),
      userProfileService.getProfileSummary(options.db, session.userId),
      findingsRepo.listRecentByUser(options.db, session.userId, 20),
      sessionMessagesRepo.listBySession(options.db, sessionId)
    ]);
    if (!user) throw new Error(`User ${session.userId} not found`);
    if (!plan) throw new Error(`Coaching plan not found for game ${session.gameId}`);

    const sessionFindings = priorFindings.filter((finding) => finding.sessionId === sessionId);

    const messages = buildSummarizerMessages({
      band: user.ratingBand,
      focusAreas: profileSummary.focusAreas,
      recentFindings: profileSummary.recentFindings,
      selfAssessment: user.selfAssessment,
      plan,
      transcript: renderTranscript(transcriptMessages),
      recordedFindings: renderRecordedFindings(sessionFindings)
    });

    const resolution = await getModelForUser(options.db, options.gatewayConfig, session.userId, 'light');
    // Constrained to SessionOutcomeSchema by the provider — this throws rather
    // than handing back something that would need re-validating below.
    const result = await generateStructured({
      resolution,
      system: messages.system,
      prompt: messages.user,
      schema: SessionOutcomeSchema
    });

    await recordUsage(options.db, {
      userId: session.userId,
      sessionId,
      provider: resolution.provider,
      model: resolution.modelId,
      tier: 'light',
      usage: toBillableTokens(result.usage),
      purpose: 'summary',
      metered: resolution.metered
    });

    await applySessionOutcome(
      options.db,
      { userId: session.userId, sessionId, gameId: session.gameId },
      result.object
    );
  };
}

function renderTranscript(messages: SessionMessageRow[]): string {
  return messages.map((message) => `${message.role}: ${JSON.stringify(message.content)}`).join('\n');
}

function renderRecordedFindings(findings: findingsRepo.FindingRow[]): string {
  if (findings.length === 0) return '(none recorded live)';
  return findings
    .map((finding) => `- [${finding.isPositive ? '+' : '-'}] ${finding.category} (ply ${finding.ply ?? '?'}): ${finding.description}`)
    .join('\n');
}
