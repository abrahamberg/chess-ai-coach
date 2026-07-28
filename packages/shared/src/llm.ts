import { z } from 'zod';

export const LlmProviderSchema = z.enum(['anthropic', 'openai']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const SetLlmKeyRequestSchema = z.object({
  apiKey: z.string().min(1)
});
export type SetLlmKeyRequest = z.infer<typeof SetLlmKeyRequestSchema>;

/** design.md §4.4: ByokKeyForm shows "saved ✓ / delete" per provider — the
 * key itself is never redisplayed, only which providers have one saved. */
export const SavedLlmProvidersResponseSchema = z.array(LlmProviderSchema);
export type SavedLlmProvidersResponse = z.infer<typeof SavedLlmProvidersResponseSchema>;
