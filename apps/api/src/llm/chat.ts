import { hasToolCall, stepCountIs, streamText, type TextStreamPart, type ToolSet } from 'ai';
import type { ModelResolution } from './gateway.js';
import type { ChatMessage, ResponseChatMessage, SystemChatMessage } from './messages.js';
import type { StreamTimeouts } from './model-options.js';
import { toTurnUsage, type TurnUsage } from './usage.js';

/** architecture §8.3: the coach may take at most this many model round-trips
 * per turn (tool call -> result -> continue) before it must answer with what
 * it has. Paired with the per-tool budgets in services/coach-tools.ts. */
const MAX_STEPS = 8;

/** The order tool definitions are sent to the provider. Fixed rather than
 * left to object-key iteration because tool definitions sit in the cached
 * prefix of every request — a reordering silently invalidates the prompt
 * cache for the whole session (AGENTS.md rule 8). Tools missing from this
 * list are still sent, just after the listed ones. */
const TOOL_ORDER = [
  'show_position',
  'annotate_board',
  'expect_move',
  'hypothetical_line',
  'check_position',
  'get_engine_analysis',
  'get_user_profile',
  'record_finding',
  'propose_focus_area_update',
  'update_threads',
  'record_move_note',
  'recall_move',
  'end_session',
  // Play mode's tools (architecture §14) — fixed at the end, never
  // interleaved with the analyze-mode 13 above, so an analyze-mode
  // session's cached tool-definition prefix never shifts.
  'get_candidate_moves',
  'play_coach_move',
  'undo_last_move'
];

/** What the caller gets back: the raw part stream plus the tool set it was
 * produced with (the UI-message encoder needs both). Deliberately NOT the
 * SDK's own result object — nothing above `llm/` should depend on its shape. */
export interface CoachTurnStream {
  stream: ReadableStream<TextStreamPart<ToolSet>>;
  tools: ToolSet;
}

/** Everything a completed turn produced, normalized for persistence and
 * metering. `messages` spans ALL steps of the turn, not just the last one. */
export interface CoachTurnCompletion {
  messages: ResponseChatMessage[];
  finishReason: string;
  usage: TurnUsage;
  providerMetadata: unknown;
}

export interface RunCoachTurnArgs {
  resolution: ModelResolution;
  /** The cached system layers plus the uncached current-position block. */
  instructions: SystemChatMessage[];
  /** The episode's own conversation, replayed from `session_messages`. */
  messages: ChatMessage[];
  tools: ToolSet;
  timeouts: StreamTimeouts;
  /** Play mode only (architecture §14): ends the turn the instant one of
   * these server tools is called, same as stepCountIs but triggered by tool
   * identity rather than a step count. The move-commit tools must be
   * server-executed (moves are authoritative, never trusted from a client
   * round-trip), so they can't rely on the client-tool "no execute() ends the
   * step loop" mechanism show_position uses — this is the equivalent for a
   * server tool. Omitted (undefined) for analyze-mode turns, leaving
   * behavior byte-for-byte unchanged. */
  stopOnToolNames?: string[];
  /** Runs once the turn is fully generated. Must never throw — by the time it
   * fires the HTTP response is already hijacked and streaming, so nothing
   * downstream can catch a rejection. */
  onFinish: (completion: CoachTurnCompletion) => Promise<void>;
  /** A mid-stream provider error. `onFinish` does NOT run in this case. */
  onError: (error: unknown) => void;
  /** The client hung up mid-stream. Neither `onFinish` nor `onError` runs. */
  onAbort: () => void;
}

/** Wraps the streaming coach call. The only place `streamText` is invoked. */
export function runCoachTurn(args: RunCoachTurnArgs): CoachTurnStream {
  const result = streamText({
    model: args.resolution.model,
    instructions: args.instructions,
    messages: args.messages,
    // A system message reaching `messages` would mean replayed history had
    // one, which the episode builder never produces — fail loudly instead of
    // letting the provider silently reorder the cached prefix.
    allowSystemInMessages: false,
    tools: args.tools,
    toolOrder: TOOL_ORDER,
    stopWhen:
      args.stopOnToolNames && args.stopOnToolNames.length > 0
        ? [stepCountIs(MAX_STEPS), ...args.stopOnToolNames.map((name) => hasToolCall(name))]
        : stepCountIs(MAX_STEPS),
    // Without these a provider that opens a stream and then stalls holds this
    // session's turn lock forever, wedging every later message in the session.
    timeout: { firstChunkMs: args.timeouts.firstChunkMs, chunkMs: args.timeouts.chunkMs },
    ...args.resolution.callOptions,
    onFinish: (event) =>
      args.onFinish({
        // `responseMessages` spans every step; the per-step `response.messages`
        // would drop the tool-call/tool-result pairs from earlier steps and
        // corrupt the append-only transcript.
        messages: event.responseMessages,
        finishReason: event.finishReason,
        usage: toTurnUsage(event.usage),
        providerMetadata: event.providerMetadata
      }),
    onError: ({ error }) => args.onError(error),
    onAbort: () => args.onAbort()
  });

  return { stream: result.stream, tools: args.tools };
}

export { MAX_STEPS };
