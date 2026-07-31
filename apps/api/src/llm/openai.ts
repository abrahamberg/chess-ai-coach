import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export function openaiModel(apiKey: string, modelId: string): LanguageModel {
  return createOpenAI({ apiKey }).responses(modelId);
}
