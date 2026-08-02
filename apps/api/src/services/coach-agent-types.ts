import type { ClientToolResult, PositionAnalysis } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import type { GatewayConfig, ModelResolution, Tier } from '../llm/gateway.js';
import type { JobQueue } from '../jobs/queue.js';
import type { CreditsService } from './credits.js';

export type ModelResolver = (
  db: Kysely<Database>,
  gatewayConfig: GatewayConfig,
  userId: string,
  tier: Tier
) => Promise<ModelResolution>;

export interface CoachAgentDependencies {
  db: Kysely<Database>;
  jobQueue: JobQueue;
  gatewayConfig: GatewayConfig;
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
  callLightModel: (messages: { system: string; user: string }) => Promise<string>;
  /** Defaults to the real gateway; tests override with a MockLanguageModelV1. */
  resolveModel?: ModelResolver;
  /** Defaults to a real CreditsService over `db`. */
  creditsService?: CreditsService;
}

export interface StartTurnInput {
  content?: string;
  clientToolResult?: ClientToolResult;
}
