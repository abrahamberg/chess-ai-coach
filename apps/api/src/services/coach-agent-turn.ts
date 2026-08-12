import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import { runCoachTurn, MAX_STEPS, type CoachTurnCompletion, type CoachTurnStream } from '../llm/chat.js';
import { getModelForUser, recordUsage, streamTimeoutsFor } from '../llm/gateway.js';
import { toBillableTokens } from '../llm/usage.js';
import { InsufficientCreditsError } from '../lib/errors.js';
import { createKeyedLock } from '../lib/keyedLock.js';
import { currentEpisode } from '../lib/episodes.js';
import { findSuccessfulToolResult } from '../lib/tool-parts.js';
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

    // currentPly: what the board/analysis shows. subjectPly: what the
    // conversation is actually about, and what this turn's messages get
    // tagged with (read by the onFinish closure further down) — the two
    // only diverge mid-flashback (applyClientToolResult). Both start at
    // whatever was current before this turn.
    let currentPly = session.currentPly;
    let subjectPly = session.subjectPly;

    if (input.content !== undefined) {
      // A student clicking a position-divider is always a deliberate
      // subject change, never a flashback — there's no "intent" concept in
      // this jump path.
      const jump = await coachContext.resolvePositionContextJump(deps.db, session.gameId, input.content);
      if (jump && jump.ply !== subjectPly) {
        const historyBeforeTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
        const closedEpisode = currentEpisode(historyBeforeTurn, subjectPly);
        await coachContext.closeEpisodeIfNeeded(deps, session.id, closedEpisode.messages, subjectPly);
        currentPly = jump.ply;
        subjectPly = jump.ply;
        await sessionsRepo.updateSubjectAndCurrentPly(deps.db, session.id, currentPly);
      }
      await sessionMessagesRepo.insert(deps.db, session.id, 'user', input.content, subjectPly);
    }
    if (input.clientToolResult) {
      const applied = await applyClientToolResult(deps, session, input.clientToolResult, currentPly, subjectPly);
      currentPly = applied.ply;
      subjectPly = applied.subjectPly;
    }

    const { staticPart, dynamicPart, studentColor } = await buildSystemPromptForSession(deps.db, session);
    const historyAfterTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
    const { instructions, messages } = await coachContext.buildEpisodeContext({
      db: deps.db,
      callLightModel: deps.callLightModel,
      session,
      currentPly,
      subjectPly,
      historyAfterTurn,
      staticPart,
      dynamicPart,
      studentColor,
      analyzePosition: deps.analyzePosition
    });

    const tools = buildCoachTools(
      { userId: session.userId, sessionId: session.id, gameId: session.gameId },
      {
        db: deps.db,
        jobQueue: deps.jobQueue,
        analyzePosition: deps.analyzePosition,
        callLightModel: deps.callLightModel
      },
      session.mode
    );
    const requestTools = serializeTools(tools);
    // architecture §14: play mode ends its turn the instant its own move
    // (or an undo) is committed, via the SDK's hasToolCall stop condition —
    // see llm/chat.ts's stopOnToolNames. Undefined for analyze mode, which
    // keeps stepCountIs(MAX_STEPS) as its only stop condition, unchanged.
    const stopOnToolNames = session.mode === 'play' ? ['play_coach_move', 'undo_last_move'] : undefined;

    return runCoachTurn({
      resolution,
      instructions,
      messages,
      tools,
      timeouts: streamTimeoutsFor(deps.gatewayConfig),
      stopOnToolNames,
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
            await sessionMessagesRepo.insert(deps.db, session.id, message.role, message.content, subjectPly);
          }
          if (session.mode === 'play') {
            await advancePlyForPlayMove(deps, session.id, subjectPly, completion.messages);
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

interface PlayCoachMoveResult {
  ply: number;
}

interface UndoLastMoveResult {
  removedPly: number;
}

/**
 * architecture §14: runs after this turn's messages are already persisted at
 * `closedPly` (the ply that was current for the whole turn), so the episode
 * being closed/replayed below genuinely includes everything just discussed —
 * mirroring the closeEpisodeIfNeeded + updateCurrentPly pairing startTurn
 * already uses for position jumps (above), just deferred to after onFinish
 * instead of before the turn starts, since play_coach_move/undo_last_move
 * are server tools whose result only exists once the turn has run.
 *
 * play_coach_move folds the coach's own move into the CLOSE of the
 * student's-move episode rather than opening a new episode of its own —
 * that's what "episode tied to every user move" means here. undo_last_move
 * skips closeEpisodeIfNeeded entirely: there is nothing sound to summarize,
 * since the episode discussed a move that no longer exists — its raw
 * messages stay in history untouched (append-only), just never folded into
 * session_move_notes for that ply.
 *
 * A failed commit (an illegal move, "no move to undo") returns `{ error }`
 * from the tool, which findSuccessfulToolResult treats as no call at all —
 * the ply intentionally does not move in that case.
 */
async function advancePlyForPlayMove(
  deps: CoachAgentDependencies,
  sessionId: string,
  closedPly: number,
  messages: CoachTurnCompletion['messages']
): Promise<void> {
  const coachMove = findSuccessfulToolResult(messages, 'play_coach_move') as PlayCoachMoveResult | null;
  if (coachMove) {
    const historyAfterTurn = await sessionMessagesRepo.listBySession(deps.db, sessionId);
    const closedEpisode = currentEpisode(historyAfterTurn, closedPly);
    await coachContext.closeEpisodeIfNeeded(deps, sessionId, closedEpisode.messages, closedPly);
    // A newly-played move is always a subject change — play mode has no
    // flashback concept (see reveal_move's same analyze-mode-only scoping).
    await sessionsRepo.updateSubjectAndCurrentPly(deps.db, sessionId, coachMove.ply);
    return;
  }

  const undo = findSuccessfulToolResult(messages, 'undo_last_move') as UndoLastMoveResult | null;
  if (undo) {
    // The undone move's subject no longer exists — revert both together,
    // same as a subject change, even though no episode closes (nothing
    // sound to summarize, per this function's doc comment above).
    await sessionsRepo.updateSubjectAndCurrentPly(deps.db, sessionId, undo.removedPly - 1);
  }
}
