import { buildCoachSystemPrompt } from '@chess-coach/prompts';
import type { ClientToolResult, EngineEval, LlmProvider } from '@chess-coach/shared';
import { streamText, zodSchema, type CoreMessage, type ProviderMetadata, type StreamTextResult, type ToolSet } from 'ai';
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
import { getPositionAtPly } from './game-positions.js';
import * as userProfileService from './user-profile.js';
import { ConflictError, InsufficientCreditsError, NotFoundError } from '../lib/errors.js';
import { createKeyedLock } from '../lib/keyedLock.js';
import type { JobQueue } from '../jobs/queue.js';
import { createCreditsService, type CreditsService } from './credits.js';

const MAX_STEPS = 8;
const SESSION_START_CONTENT = '[session_start]';

/** Serializes startTurn calls per session — see createKeyedLock's doc comment
 * for why this is needed (the client-tool round-trip race). */
const sessionLock = createKeyedLock();

/** Provider-normalized token usage for a turn (coach debug mode design doc,
 * "Provider-specific usage"). `cacheWriteTokens` is `null` — never `0` — for
 * OpenAI, since it has no cache-write concept at all (its prefix caching is
 * automatic and free to populate). */
export interface TurnUsage {
  freshInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number | null;
  outputTokens: number;
}

/** Literal request/response snapshot for the coach debug popup — deliberately
 * NOT reshaped: `request.messages` is the exact array passed to `streamText`,
 * `response.messages`/`finishReason`/`providerMetadata` are exactly what
 * `onFinish` received. Latest-turn-only: stored on the session row (see
 * `sessionsRepo.updateDebugSnapshot`/`getDebugSnapshot`), overwritten every
 * turn — no historical persistence, but (unlike an in-memory Map) consistent
 * across pods and process restarts. */
export interface TurnDebugSnapshot {
  request: {
    provider: LlmProvider;
    model: string;
    messages: CoreMessage[];
    tools: Array<{ name: string; description: string; parameters: unknown }>;
    maxSteps: number;
  };
  response: {
    messages: unknown[];
    finishReason: string;
    usage: TurnUsage;
    providerMetadata: unknown;
  };
}

export async function getLastTurnDebugSnapshot(
  db: Kysely<Database>,
  sessionId: string
): Promise<TurnDebugSnapshot | undefined> {
  const snapshot = await sessionsRepo.getDebugSnapshot(db, sessionId);
  return snapshot as TurnDebugSnapshot | undefined;
}

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

/** The Games page's "start session" action: if the student already has an
 * ongoing session for this game, link back into it instead of starting a
 * second one over the same game. */
export async function resumeOrCreateSession(
  db: Kysely<Database>,
  userId: string,
  gameId: string
): Promise<SessionRow> {
  const existing = await sessionsRepo.findActiveByGameIdForUser(db, gameId, userId);
  if (existing) return existing;
  return createSession(db, userId, gameId);
}

/** Student-initiated "start over": abandons the current session and opens a
 * fresh one for the same game. */
export async function resetSession(db: Kysely<Database>, userId: string, sessionId: string): Promise<SessionRow> {
  const session = await sessionsRepo.findByIdForUser(db, sessionId, userId);
  if (!session) throw new NotFoundError('Session not found');
  if (session.status === 'completed' || session.status === 'abandoned') {
    throw new ConflictError('Session has already ended');
  }

  await sessionsRepo.markAbandoned(db, session.id);
  return createSession(db, userId, session.gameId);
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
  // Held until onFinish below has persisted this turn's messages — a client
  // tool-result arrives as a brand-new HTTP request the instant the tool-call
  // streams to the browser, which can otherwise race this turn's own
  // still-in-flight persistence and read the history before its own
  // tool-call message exists (the tool-result then lands first, an ordering
  // OpenAI rejects on every future replay of the session).
  const release = await sessionLock.acquire(session.id);
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    release();
  };

  try {
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
    const requestMessages = buildCacheableMessages(staticPart, dynamicPart, priorMessages.map(toCoreMessage));

    const tools = buildCoachTools(
      { userId: session.userId, sessionId: session.id, gameId: session.gameId },
      {
        db: deps.db,
        jobQueue: deps.jobQueue,
        analyzePosition: deps.analyzePosition,
        callLightModel: deps.callLightModel
      }
    );
    const requestTools = serializeTools(tools);

    return streamText({
      model: resolution.model,
      messages: requestMessages,
      tools,
      maxSteps: MAX_STEPS,
      onFinish: async (event) => {
        // streamText's response has already been piped to the client by the
        // time this runs (see routes/sessions.ts's reply.hijack()), so nothing
        // downstream can catch a rejection here — an uncaught error would
        // otherwise crash the whole process (seen live: a NaN token count from
        // a provider quirk took down the entire API). Persisting the transcript
        // and metering the call must never be able to do that.
        try {
          const usage = normalizeUsage(resolution.provider, event.usage, event.providerMetadata);

          // Debug snapshot capture is independent of the persistence/metering
          // below — written first so a failure further down never hides it.
          await sessionsRepo.updateDebugSnapshot(deps.db, session.id, {
            request: {
              provider: resolution.provider,
              model: resolution.modelId,
              messages: requestMessages,
              tools: requestTools,
              maxSteps: MAX_STEPS
            },
            response: {
              messages: event.response.messages,
              finishReason: event.finishReason,
              usage,
              providerMetadata: event.providerMetadata
            }
          } satisfies TurnDebugSnapshot);

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
              // Total input tokens (fresh + reused-from-cache) — matches
              // computeCredits' expectation of pre-discount total input.
              // Cache-write tokens are intentionally excluded (billing math
              // for the cache-write premium is out of scope; see design doc).
              inputTokens: usage.freshInputTokens + usage.cacheReadTokens,
              outputTokens: usage.outputTokens,
              cachedInputTokens: usage.cacheReadTokens
            },
            purpose: 'coach_turn',
            metered: resolution.metered
          });
        } catch (error) {
          console.error(`coach-agent onFinish failed for session ${session.id}:`, error);
        } finally {
          releaseOnce();
        }
      }
    });
  } catch (error) {
    releaseOnce();
    throw error;
  }
}

async function applyClientToolResult(
  db: Kysely<Database>,
  session: SessionRow,
  toolResult: NonNullable<StartTurnInput['clientToolResult']>
): Promise<void> {
  let result = toolResult.result;
  if (toolResult.toolName === 'show_position') {
    const { ply } = toolResult.result as { ply: number };
    await sessionsRepo.updateCurrentPly(db, session.id, ply);
    result = await withAuthoritativeFen(db, session.gameId, ply, toolResult.result);
  }
  await sessionMessagesRepo.insert(db, session.id, 'tool', [
    { type: 'tool-result', toolCallId: toolResult.toolCallId, toolName: toolResult.toolName, result }
  ]);
}

/**
 * The client reports {moveNumber, color, ply} for a show_position round-trip
 * but never a FEN — so, left alone, this tool-result is the coach's only
 * per-move checkpoint in the whole conversation and it carries no ground
 * truth about the actual position. Stamping the server-computed FEN onto it
 * here means the coach receives a verified FEN through the same in-band,
 * cache-safe channel the thread ledger uses (architecture §7.5), for every
 * position it ever shows — instead of silently reconstructing one from
 * memory when it later needs one for get_engine_analysis.
 */
async function withAuthoritativeFen(
  db: Kysely<Database>,
  gameId: string,
  ply: number,
  result: unknown
): Promise<unknown> {
  const position = await getPositionAtPly(db, gameId, ply);
  if (!position) return result;
  return { ...(result as object), fen: position.fen };
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

/**
 * architecture §8.1: static instructions and per-session dynamic context each
 * get their own Anthropic cache breakpoint; the conversation itself is left
 * uncached (it's not a stable prefix). Two leading `role: 'system'` messages
 * (rather than one `system` string) is what lets each carry its own
 * `cache_control` — verified against the installed SDK (`ai@4.3.19`,
 * `@ai-sdk/anthropic@1.2.12`): the Anthropic provider merges consecutive
 * system messages into independently-cacheable content blocks.
 * `providerOptions.anthropic` is a harmless no-op for OpenAI, whose prefix
 * caching is automatic and gets the same discount for free from this same
 * static/dynamic/conversation ordering.
 */
export function buildCacheableMessages(
  staticPart: string,
  dynamicPart: string,
  priorMessages: CoreMessage[]
): CoreMessage[] {
  const cacheControl = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
  return [
    { role: 'system', content: staticPart, providerOptions: cacheControl },
    { role: 'system', content: dynamicPart, providerOptions: cacheControl },
    ...priorMessages
  ];
}

/** Providers occasionally report non-finite usage on multi-step tool-calling
 * turns (same quirk `gateway.ts`'s `toSafeCount` guards against for the DB
 * columns) — a NaN here would silently serialize to `null` over JSON and fail
 * the frontend's schema validation, so every number normalizeUsage produces
 * is sanitized at this boundary too. */
function toSafeCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Reconciles Anthropic's and OpenAI's incompatible usage-reporting shapes
 * (design doc, "Provider-specific usage"): Anthropic's `promptTokens` is
 * fresh-only and cache stats live in `providerMetadata.anthropic`; OpenAI's
 * `promptTokens` already includes cached tokens and has no cache-write
 * concept at all (hence `cacheWriteTokens: null`, never coerced to 0).
 */
export function normalizeUsage(
  provider: LlmProvider,
  usage: { promptTokens: number; completionTokens: number },
  providerMetadata: ProviderMetadata | undefined
): TurnUsage {
  const promptTokens = toSafeCount(usage.promptTokens);
  const completionTokens = toSafeCount(usage.completionTokens);

  if (provider === 'anthropic') {
    const anthropic = providerMetadata?.anthropic as
      | { cacheCreationInputTokens?: number | null; cacheReadInputTokens?: number | null }
      | undefined;
    return {
      freshInputTokens: promptTokens,
      cacheReadTokens: toSafeCount(anthropic?.cacheReadInputTokens),
      cacheWriteTokens: toSafeCount(anthropic?.cacheCreationInputTokens),
      outputTokens: completionTokens
    };
  }

  const openai = providerMetadata?.openai as { cachedPromptTokens?: number | null } | undefined;
  const cacheReadTokens = toSafeCount(openai?.cachedPromptTokens);
  return {
    freshInputTokens: promptTokens - cacheReadTokens,
    cacheReadTokens,
    cacheWriteTokens: null,
    outputTokens: completionTokens
  };
}

/** Schema-only serialization of the coach's tool set for the debug snapshot —
 * name/description/JSON-schema-parameters, never the JS closures. */
function serializeTools(tools: ToolSet): TurnDebugSnapshot['request']['tools'] {
  return Object.entries(tools).map(([name, coreTool]) => ({
    name,
    description: coreTool.description ?? '',
    parameters: parametersToJsonSchema(coreTool.parameters)
  }));
}

function parametersToJsonSchema(parameters: unknown): unknown {
  if (typeof parameters === 'object' && parameters !== null && 'jsonSchema' in parameters) {
    return (parameters as { jsonSchema: unknown }).jsonSchema;
  }
  return zodSchema(parameters as Parameters<typeof zodSchema>[0]).jsonSchema;
}
