import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/** Uses the Responses API (`/v1/responses`), not the default Chat Completions
 * path: OpenAI's newer reasoning models (gpt-5.x and later) reject function
 * tools on `/v1/chat/completions` outright and require `/v1/responses`. */
export function openaiModel(apiKey: string, modelId: string): LanguageModel {
  return createOpenAI({ apiKey }).responses(modelId);
}
