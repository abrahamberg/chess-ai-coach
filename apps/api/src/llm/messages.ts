import type { AssistantModelMessage, ModelMessage, SystemModelMessage, ToolModelMessage } from 'ai';

/** The app's name for a provider-bound chat message. Everything above `llm/`
 * uses these aliases so the AI SDK's own message types stay behind this
 * boundary (AGENTS.md rule 6) — a future SDK rename lands here alone. */
export type ChatMessage = ModelMessage;
export type SystemChatMessage = SystemModelMessage;

/** What a model call can produce. Narrower than `ChatMessage` on purpose: the
 * roles here line up exactly with `SessionMessageRole`, so every generated
 * message can be persisted to the append-only transcript without a cast. */
export type ResponseChatMessage = AssistantModelMessage | ToolModelMessage;

/**
 * A system block the provider is asked to cache (design doc §5). Anthropic
 * bills a cache write once and reads it back at a fraction of the price on
 * every later turn; OpenAI ignores the option and caches prefixes
 * automatically, so the same call site is correct for both providers.
 *
 * Anthropic allows at most FOUR cache breakpoints per request — see
 * `buildEpisodeMessages` in services/coach-context.ts, which spends all four.
 * A fifth cached block cannot be added without dropping one of those, or the
 * request starts failing at the provider.
 */
export function cachedSystemMessage(content: string): SystemChatMessage {
  return {
    role: 'system',
    content,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
  };
}

export function systemMessage(content: string): SystemChatMessage {
  return { role: 'system', content };
}
