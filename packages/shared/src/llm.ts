import { z } from 'zod';

export const LlmProviderSchema = z.enum(['anthropic', 'openai']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const SetLlmKeyRequestSchema = z.object({
  apiKey: z.string().min(1)
});
export type SetLlmKeyRequest = z.infer<typeof SetLlmKeyRequestSchema>;
