import { generateObject, generateText } from 'ai';
import type { z } from 'zod';
import type { ModelResolution } from './gateway.js';
import { toTurnUsage, type TurnUsage } from './usage.js';

export interface TextCallArgs {
  resolution: ModelResolution;
  system: string;
  prompt: string;
}

/**
 * A single-shot prose call — the light-tier workhorse behind every mechanical
 * subagent (episode folds, mid-episode compaction, `recall_move`). Callers get
 * text and usage; the model, reasoning level and provider options all ride on
 * the resolution.
 */
export async function generateProse(args: TextCallArgs): Promise<{ text: string; usage: TurnUsage }> {
  const result = await generateText({
    model: args.resolution.model,
    instructions: args.system,
    prompt: args.prompt,
    ...args.resolution.callOptions
  });
  return { text: result.text, usage: toTurnUsage(result.usage) };
}

export interface StructuredCallArgs<T> extends TextCallArgs {
  schema: z.ZodType<T>;
}

/**
 * A single-shot call whose output is constrained to a zod schema by the
 * provider itself, replacing the hand-rolled `JSON.parse` -> `safeParse` ->
 * retry-with-the-zod-issues loop the planner and summarizer used to run.
 * Throws (`NoObjectGeneratedError`) rather than returning a partial object, so
 * callers keep the existing "LLM output never reaches the DB unvalidated"
 * guarantee for free.
 */
export async function generateStructured<T>(args: StructuredCallArgs<T>): Promise<{ object: T; usage: TurnUsage }> {
  const result = await generateObject({
    model: args.resolution.model,
    instructions: args.system,
    prompt: args.prompt,
    schema: args.schema,
    ...args.resolution.callOptions
  });
  return { object: result.object, usage: toTurnUsage(result.usage) };
}
