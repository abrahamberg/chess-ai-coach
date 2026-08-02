import type { LlmProvider } from '@chess-coach/shared';
import { zodSchema, type CoreMessage, type ToolSet } from 'ai';
import type { Kysely } from 'kysely';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import type { TurnUsage } from './coach-agent-usage.js';

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

/** Schema-only serialization of the coach's tool set for the debug snapshot —
 * name/description/JSON-schema-parameters, never the JS closures. */
export function serializeTools(tools: ToolSet): TurnDebugSnapshot['request']['tools'] {
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
