import type { ColumnType, Generated } from 'kysely';
import type { MistakeCategory, RatingBand } from '@chess-coach/shared';

/** jsonb columns: pg parses them to JS values on select; inserts/updates must pass a JSON string. */
type Jsonb<T> = ColumnType<T, string, string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  displayName: string;
  ratingBand: Generated<RatingBand>;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  selfAssessment: string | null;
  createdAt: Generated<Date>;
}

export interface UserLlmKeysTable {
  userId: string;
  provider: 'anthropic' | 'openai';
  keyCiphertext: Buffer;
  keyIv: Buffer;
  createdAt: Generated<Date>;
}

export interface GamesTable {
  id: Generated<string>;
  userId: string;
  pgn: string;
  source: 'paste' | 'upload' | 'lichess';
  userColor: 'white' | 'black';
  whiteName: string | null;
  blackName: string | null;
  result: string | null;
  timeControl: string | null;
  eco: string | null;
  playedAt: Date | null;
  createdAt: Generated<Date>;
}

export interface AnalysesTable {
  id: Generated<string>;
  gameId: string;
  status: 'queued' | 'engine_running' | 'planning' | 'ready' | 'failed';
  error: string | null;
  engineEvals: Jsonb<unknown> | null;
  coachingPlan: Jsonb<unknown> | null;
  classifiedMoves: Jsonb<unknown> | null;
  createdAt: Generated<Date>;
  completedAt: Date | null;
}

export interface SessionsTable {
  id: Generated<string>;
  gameId: string;
  userId: string;
  status: 'active' | 'completed' | 'paused_no_credits' | 'abandoned';
  currentPly: Generated<number>;
  threads: ColumnType<unknown, string | undefined, string>;
  debugSnapshot: ColumnType<unknown, string | null | undefined, string | null>;
  contextDigest: string | null;
  digestThroughMessageId: string | null;
  summary: string | null;
  homework: string | null;
  startedAt: Generated<Date>;
  endedAt: Date | null;
}

export interface SessionMessagesTable {
  id: Generated<string>;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: Jsonb<unknown>;
  createdAt: Generated<Date>;
}

export interface FindingsTable {
  id: Generated<string>;
  userId: string;
  sessionId: string | null;
  gameId: string | null;
  category: MistakeCategory;
  severity: 'minor' | 'significant' | 'critical';
  ply: number | null;
  description: string;
  isPositive: Generated<boolean>;
  createdAt: Generated<Date>;
}

export interface FocusAreasTable {
  id: Generated<string>;
  userId: string;
  category: MistakeCategory;
  status: 'active' | 'improving' | 'resolved';
  note: string;
  evidenceCount: Generated<number>;
  lastSeenAt: Generated<Date>;
  createdAt: Generated<Date>;
}

export interface CreditLedgerTable {
  id: Generated<string>;
  userId: string;
  delta: number;
  reason: 'signup_grant' | 'purchase' | 'session_usage' | 'refund';
  sessionId: string | null;
  stripeEventId: string | null;
  createdAt: Generated<Date>;
}

export interface LlmCallLogTable {
  id: Generated<string>;
  userId: string;
  sessionId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: Generated<number>;
  creditsMetered: Generated<number>;
  purpose: string;
  createdAt: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  userLlmKeys: UserLlmKeysTable;
  games: GamesTable;
  analyses: AnalysesTable;
  sessions: SessionsTable;
  sessionMessages: SessionMessagesTable;
  findings: FindingsTable;
  focusAreas: FocusAreasTable;
  creditLedger: CreditLedgerTable;
  llmCallLog: LlmCallLogTable;
}
