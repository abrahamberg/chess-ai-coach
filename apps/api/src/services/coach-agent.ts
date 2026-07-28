import { buildCoachSystemPrompt } from '@chess-coach/prompts';
import type { ClientToolResult, EngineEval } from '@chess-coach/shared';
import { streamText, type CoreMessage, type StreamTextResult, type ToolSet } from 'ai';
import type { Kysely } from 'kysely';
import * as analysesRepo from '../db/repositories/analyses.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import type { SessionMessageRow } from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import * as usersRepo from '../db/repositories/users.js';
import type { Database } from '../db/schema.js';
import { getModelForUser, recordUsage, type GatewayConfig, type ModelResolution, type Tier } from '../llm/gateway.js';
import { buildCoachTools } from './coach-tools.js';
import * as userProfileService from './user-profile.js';
import { InsufficientCreditsError, NotFoundError } from '../lib/errors.js';
import type { JobQueue } from '../jobs/queue.js';
import { createCreditsService, type CreditsService } from './credits.js';

const MAX_STEPS = 8;
const SESSION_START_CONTENT = '[session_start]';

export type ModelResolver = (
  db: Kysely<Database>,
  gatewayConfig: GatewayConfig,
  userId: string,
  tier: Tier
) => Promise<ModelResolution>;

export interface CoachAgentDependencies {
  db: Kysely<Database>;
  jobQueue: JobQueue;
  gatewayConfig: GatewayConfig;
  analyzePosition: (fen: string) => Promise<EngineEval>;
  callLightModel: (messages: { system: string; user: string }) => Promise<string>;
  /** Defaults to the real gateway; tests override with a MockLanguageModelV1. */
  resolveModel?: ModelResolver;
  /** Defaults to a real CreditsService over `db`. */
  creditsService?: CreditsService;
}

export async function createSession(
  db: Kysely<Database>,
  userId: string,
  gameId: string
): Promise<SessionRow> {
  const game = await gamesRepo.findByIdForUser(db, gameId, userId);
  if (!game) throw new NotFoundError('Game not found');

  const session = await sessionsRepo.insert(db, { gameId: game.id, userId });
  await sessionMessagesRepo.insert(db, session.id, 'user', SESSION_START_CONTENT);
  return session;
}

export interface SessionDetail extends SessionRow {
  messages: SessionMessageRow[];
}

export async function getSessionDetail(
  db: Kysely<Database>,
  sessionId: string,
  userId: string
): Promise<SessionDetail | undefined> {
  const session = await sessionsRepo.findByIdForUser(db, sessionId, userId);
  if (!session) return undefined;
  const messages = await sessionMessagesRepo.listBySession(db, sessionId);
  return { ...session, messages: filterBackstageMessages(messages) };
}

const BACKSTAGE_TOOL_NAME = 'update_threads';

/** architecture §7.1: the thread ledger is backstage — never rendered to the
 * student. Strips update_threads tool-call/tool-result parts from each
 * message's content (keeping any other parts, e.g. spoken text alongside the
 * tool call), then drops any message left with no parts. */
function filterBackstageMessages(messages: SessionMessageRow[]): SessionMessageRow[] {
  return messages
    .map((message) => ({ ...message, content: stripBackstageParts(message.content) }))
    .filter((message) => !isEmptyContent(message.content));
}

function stripBackstageParts(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.filter((part) => !isBackstageToolPart(part));
}

function isBackstageToolPart(part: unknown): boolean {
  if (typeof part !== 'object' || part === null) return false;
  const candidate = part as { type?: unknown; toolName?: unknown };
  return (
    (candidate.type === 'tool-call' || candidate.type === 'tool-result') &&
    candidate.toolName === BACKSTAGE_TOOL_NAME
  );
}

function isEmptyContent(content: unknown): boolean {
  return Array.isArray(content) && content.length === 0;
}

export interface StartTurnInput {
  content?: string;
  clientToolResult?: ClientToolResult;
}

/**
 * architecture §7.2 turn flow: check credits (if metered) -> persist the new
 * user input -> streamText with the full replayed history -> onFinish persists
 * generated messages append-only and meters usage.
 */
export async function startTurn(
  deps: CoachAgentDependencies,
  session: SessionRow,
  input: StartTurnInput
): Promise<StreamTextResult<ToolSet, never>> {
  const resolveModel = deps.resolveModel ?? getModelForUser;
  const resolution = await resolveModel(deps.db, deps.gatewayConfig, session.userId, 'standard');

  if (resolution.metered) {
    const creditsService = deps.creditsService ?? createCreditsService(deps.db);
    try {
      await creditsService.assertCanSpend(session.userId);
    } catch (error) {
      await sessionsRepo.markPausedNoCredits(deps.db, session.id);
      throw error instanceof InsufficientCreditsError
        ? error
        : new InsufficientCreditsError('Insufficient credits');
    }
  }

  if (input.content !== undefined) {
    await sessionMessagesRepo.insert(deps.db, session.id, 'user', input.content);
  }
  if (input.clientToolResult) {
    await applyClientToolResult(deps.db, session, input.clientToolResult);
  }

  const { staticPart, dynamicPart } = await buildSystemPromptForSession(deps.db, session);
  const priorMessages = await sessionMessagesRepo.listBySession(deps.db, session.id);
  const messages = priorMessages.map(toCoreMessage);

  const tools = buildCoachTools(
    { userId: session.userId, sessionId: session.id, gameId: session.gameId },
    {
      db: deps.db,
      jobQueue: deps.jobQueue,
      analyzePosition: deps.analyzePosition,
      callLightModel: deps.callLightModel
    }
  );

  return streamText({
    model: resolution.model,
    system: `${staticPart}\n\n${dynamicPart}`,
    messages,
    tools,
    maxSteps: MAX_STEPS,
    onFinish: async (event) => {
      for (const message of event.response.messages) {
        await sessionMessagesRepo.insert(deps.db, session.id, message.role, message.content);
      }
      await recordUsage(deps.db, {
        userId: session.userId,
        sessionId: session.id,
        provider: resolution.provider,
        model: resolution.modelId,
        tier: 'standard',
        usage: {
          inputTokens: event.usage.promptTokens,
          outputTokens: event.usage.completionTokens,
          cachedInputTokens: 0
        },
        purpose: 'coach_turn',
        metered: resolution.metered
      });
    }
  });
}

async function applyClientToolResult(
  db: Kysely<Database>,
  session: SessionRow,
  toolResult: NonNullable<StartTurnInput['clientToolResult']>
): Promise<void> {
  if (toolResult.toolName === 'show_position') {
    const { ply } = toolResult.result as { ply: number };
    await sessionsRepo.updateCurrentPly(db, session.id, ply);
  }
  await sessionMessagesRepo.insert(db, session.id, 'tool', [
    { type: 'tool-result', toolCallId: toolResult.toolCallId, toolName: toolResult.toolName, result: toolResult.result }
  ]);
}

async function buildSystemPromptForSession(
  db: Kysely<Database>,
  session: SessionRow
): Promise<{ staticPart: string; dynamicPart: string }> {
  const [user, game, plan, profileSummary, sessionCount] = await Promise.all([
    usersRepo.findById(db, session.userId),
    gamesRepo.findById(db, session.gameId),
    analysesRepo.findCoachingPlanByGameId(db, session.gameId),
    userProfileService.getProfileSummary(db, session.userId),
    sessionsRepo.countByUser(db, session.userId)
  ]);
  if (!user) throw new NotFoundError('User not found');
  if (!game) throw new NotFoundError('Game not found');
  if (!plan) throw new NotFoundError('Coaching plan not found');

  return buildCoachSystemPrompt({
    user: { displayName: user.displayName, selfAssessment: user.selfAssessment, sessionCount },
    band: user.ratingBand,
    game: {
      whiteName: game.whiteName ?? 'White',
      blackName: game.blackName ?? 'Black',
      result: game.result ?? '*',
      timeControl: game.timeControl ?? 'unknown',
      userColor: game.userColor
    },
    plan,
    focusAreas: profileSummary.focusAreas,
    recentFindings: profileSummary.recentFindings
  });
}

function toCoreMessage(row: SessionMessageRow): CoreMessage {
  return { role: row.role, content: row.content } as CoreMessage;
}
