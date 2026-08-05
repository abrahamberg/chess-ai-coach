import type { LlmProvider, ReasoningEffort } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import type { ChatMessage, SystemChatMessage } from '../llm/messages.js';
import { toolJsonSchema, type ToolSet } from '../llm/tools.js';
import type { TurnUsage } from '../llm/usage.js';

/** Literal request/response snapshot for the coach debug popup — deliberately
 * NOT reshaped: `request.instructions`/`request.messages` are the exact arrays
 * the model call received, `response.*` is exactly what it returned. Latest-
 * turn-only: stored on the session row (see `sessionsRepo.updateDebugSnapshot`/
 * `getDebugSnapshot`), overwritten every turn — no historical persistence, but
 * (unlike an in-memory Map) consistent across pods and process restarts. */
export interface TurnDebugSnapshot {
  request: {
    provider: LlmProvider;
    model: string;
    /** The cached system layers, sent in the provider's system slot. */
    instructions: SystemChatMessage[];
    messages: ChatMessage[];
    tools: Array<{ name: string; description: string; parameters: unknown }>;
    maxSteps: number;
    reasoning: ReasoningEffort;
    providerOptions: unknown;
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

/** Schema-only serialization of the coach's tool set for the debug snapshot —
 * name/description/JSON-schema-parameters, never the JS closures. */
export function serializeTools(tools: ToolSet): TurnDebugSnapshot['request']['tools'] {
  return Object.entries(tools).map(([name, definition]) => ({
    name,
    description: typeof definition.description === 'string' ? definition.description : '',
    parameters: toolJsonSchema(definition)
  }));
}
