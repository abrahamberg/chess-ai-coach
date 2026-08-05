import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import { runCoachTurn, MAX_STEPS, type CoachTurnStream } from '../llm/chat.js';
import { getModelForUser, recordUsage, streamTimeoutsFor } from '../llm/gateway.js';
import { toBillableTokens } from '../llm/usage.js';
import { InsufficientCreditsError } from '../lib/errors.js';
import { createKeyedLock } from '../lib/keyedLock.js';
import { currentEpisode } from '../lib/episodes.js';
import { buildCoachTools } from './coach-tools.js';
import * as coachContext from './coach-context.js';
import { createCreditsService } from './credits.js';
import { applyClientToolResult } from './coach-agent-client-tool-result.js';
import { buildSystemPromptForSession } from './coach-agent-system-prompt.js';
import { serializeTools, type TurnDebugSnapshot } from './coach-agent-debug.js';
import type { CoachAgentDependencies, StartTurnInput } from './coach-agent-types.js';

/** Serializes startTurn calls per session — see createKeyedLock's doc comment
 * for why this is needed (the client-tool round-trip race). */
const sessionLock = createKeyedLock();

/**
 * architecture §7.2 turn flow: check credits (if metered) -> persist the new
 * user input -> stream the coach turn with the full replayed history ->
 * onFinish persists generated messages append-only and meters usage.
 */
export async function startTurn(
  deps: CoachAgentDependencies,
  session: SessionRow,
  input: StartTurnInput
): Promise<CoachTurnStream> {
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

    // Tracks the ply this turn's messages get tagged with — starts at
    // whatever was current before this turn, and only ever moves forward
    // via a resolved jump or a show_position client-tool-result, both
    // below. Read by the onFinish closure further down.
    let currentPly = session.currentPly;

    if (input.content !== undefined) {
      const jump = await coachContext.resolvePositionContextJump(deps.db, session.gameId, input.content);
      if (jump && jump.ply !== currentPly) {
        const historyBeforeTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
        const closedEpisode = currentEpisode(historyBeforeTurn, currentPly);
        await coachContext.closeEpisodeIfNeeded(deps, session.id, closedEpisode.messages, currentPly);
        currentPly = jump.ply;
        await sessionsRepo.updateCurrentPly(deps.db, session.id, currentPly);
      }
      await sessionMessagesRepo.insert(deps.db, session.id, 'user', input.content, currentPly);
    }
    if (input.clientToolResult) {
      currentPly = await applyClientToolResult(deps, session, input.clientToolResult, currentPly);
    }

    const { staticPart, dynamicPart, showEngineAnalysis } = await buildSystemPromptForSession(deps.db, session);
    const historyAfterTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
    const { instructions, messages } = await coachContext.buildEpisodeContext({
      db: deps.db,
      callLightModel: deps.callLightModel,
      session,
      currentPly,
      historyAfterTurn,
      staticPart,
      dynamicPart,
      analyzePosition: deps.analyzePosition,
      showEngineAnalysis
    });

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

    return runCoachTurn({
      resolution,
      instructions,
      messages,
      tools,
      timeouts: streamTimeoutsFor(deps.gatewayConfig),
      onFinish: async (completion) => {
        // The response has already been piped to the client by the time this
        // runs (see routes/sessions.ts's reply.hijack()), so nothing
        // downstream can catch a rejection here — an uncaught error would
        // otherwise crash the whole process (seen live: a NaN token count
        // from a provider quirk took down the entire API). Persisting the
        // transcript and metering the call must never be able to do that.
        try {
          // Debug snapshot capture is independent of the persistence/metering
          // below — written first so a failure further down never hides it.
          await sessionsRepo.updateDebugSnapshot(deps.db, session.id, {
            request: {
              provider: resolution.provider,
              model: resolution.modelId,
              instructions,
              messages,
              tools: requestTools,
              maxSteps: MAX_STEPS,
              reasoning: resolution.callOptions.reasoning,
              providerOptions: resolution.callOptions.providerOptions ?? null
            },
            response: {
              messages: completion.messages,
              finishReason: completion.finishReason,
              usage: completion.usage,
              providerMetadata: completion.providerMetadata
            }
          } satisfies TurnDebugSnapshot);

          for (const message of completion.messages) {
            await sessionMessagesRepo.insert(deps.db, session.id, message.role, message.content, currentPly);
          }
          await recordUsage(deps.db, {
            userId: session.userId,
            sessionId: session.id,
            provider: resolution.provider,
            model: resolution.modelId,
            tier: 'standard',
            usage: toBillableTokens(completion.usage),
            purpose: 'coach_turn',
            metered: resolution.metered
          });
        } catch (error) {
          console.error(`coach-agent onFinish failed for session ${session.id}:`, error);
        } finally {
          releaseOnce();
        }
      },
      // A stream-level provider error (e.g. a mid-stream 400) skips onFinish
      // entirely (the SDK only calls onFinish once a step has completed), so
      // without this the lock above would never release and every future
      // message in this session would hang forever awaiting sessionLock.
      onError: (error) => {
        console.error(`coach-agent stream error for session ${session.id}:`, error);
        releaseOnce();
      },
      // Client hung up mid-stream: neither onFinish nor onError fires, and the
      // lock would leak in exactly the same way.
      onAbort: () => {
        releaseOnce();
      }
    });
  } catch (error) {
    releaseOnce();
    throw error;
  }
}
