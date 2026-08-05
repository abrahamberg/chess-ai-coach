import { z } from 'zod';

export const LlmProviderSchema = z.enum(['anthropic', 'openai']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

/** The AI SDK's portable reasoning-effort scale — one setting that both
 * Anthropic (thinking budget) and OpenAI (reasoning effort) translate to
 * natively, so the gateway never branches on provider to enable reasoning.
 * Parsed from LLM_REASONING_STANDARD/_LIGHT so a typo fails at boot rather
 * than at the provider. */
export const ReasoningEffortSchema = z.enum([
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/** OpenAI's Responses-API service tier. `flex` trades latency for roughly
 * half the price and can return resource-unavailable errors, so it stays off
 * by default (`auto`) and is switched on per-deployment via
 * LLM_OPENAI_SERVICE_TIER. Anthropic has no equivalent knob. */
export const OpenAiServiceTierSchema = z.enum(['auto', 'default', 'flex', 'priority']);
export type OpenAiServiceTier = z.infer<typeof OpenAiServiceTierSchema>;

export const SetLlmKeyRequestSchema = z.object({
  apiKey: z.string().min(1)
});
export type SetLlmKeyRequest = z.infer<typeof SetLlmKeyRequestSchema>;

/** design.md §4.4: ByokKeyForm shows "saved ✓ / delete" per provider — the
 * key itself is never redisplayed, only which providers have one saved. */
export const SavedLlmProvidersResponseSchema = z.array(LlmProviderSchema);
export type SavedLlmProvidersResponse = z.infer<typeof SavedLlmProvidersResponseSchema>;
