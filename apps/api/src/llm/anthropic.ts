import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

export function anthropicModel(apiKey: string, modelId: string): LanguageModel {
  return createAnthropic({ apiKey })(modelId);
}
