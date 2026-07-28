import { LlmProviderSchema, SetLlmKeyRequestSchema } from '@chess-coach/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import * as llmKeysRepo from '../db/repositories/llm-keys.js';
import type { Database } from '../db/schema.js';
import type { KeyVault } from '../llm/key-vault.js';
import { ValidationError } from '../lib/errors.js';
import * as userProfileService from '../services/user-profile.js';

export function registerLlmKeysRoutes(app: FastifyInstance, db: Kysely<Database>, keyVault: KeyVault): void {
  app.put<{ Params: { provider: string } }>('/api/users/me/llm-keys/:provider', async (request, reply) => {
    const provider = parseProvider(request.params.provider);
    const parsed = SetLlmKeyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const user = await userProfileService.getOrCreate(db, request.user);
    const { ciphertext, iv } = keyVault.encrypt(parsed.data.apiKey);
    await llmKeysRepo.upsert(db, user.id, provider, ciphertext, iv);
    return reply.code(204).send();
  });

  app.delete<{ Params: { provider: string } }>('/api/users/me/llm-keys/:provider', async (request, reply) => {
    const provider = parseProvider(request.params.provider);
    const user = await userProfileService.getOrCreate(db, request.user);
    await llmKeysRepo.remove(db, user.id, provider);
    return reply.code(204).send();
  });
}

function parseProvider(raw: string): 'anthropic' | 'openai' {
  const parsed = LlmProviderSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(`Unknown LLM provider: ${raw}`);
  return parsed.data;
}
