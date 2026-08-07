import { z } from 'zod';
import { FindingSchema, FocusAreaUpdateSchema } from './finding.js';
import { PlayerColorSchema } from './game.js';

export const SessionStatusSchema = z.enum(['active', 'completed', 'paused_no_credits', 'abandoned']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** 'analyze': walking through an already-finished imported game (today's only
 * mode). 'play': a live sparring game against the coach — see architecture.md
 * §14 for the full play-mode design. */
export const SessionModeSchema = z.enum(['analyze', 'play']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionOutcomeSchema = z.object({
  sessionSummary: z.string(),
  homework: z.string().nullable(),
  findings: z.array(FindingSchema).max(10),
  focusAreaUpdates: z.array(FocusAreaUpdateSchema).max(4)
});
export type SessionOutcome = z.infer<typeof SessionOutcomeSchema>;

export const CreateSessionRequestSchema = z.object({
  gameId: z.string().min(1)
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

/** architecture §14: starts a fresh live sparring game — no gameId, since
 * play mode creates its own `coach_play` game rather than importing one. */
export const CreatePlaySessionRequestSchema = z.object({
  studentColor: PlayerColorSchema
});
export type CreatePlaySessionRequest = z.infer<typeof CreatePlaySessionRequestSchema>;

/** POST /api/sessions/:id/play-move body — the student's move, validated
 * and committed synchronously before any chat turn starts. */
export const CommitPlayerMoveRequestSchema = z.object({
  san: z.string().min(1)
});
export type CommitPlayerMoveRequest = z.infer<typeof CommitPlayerMoveRequestSchema>;

export const ClientToolResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.unknown()
});
export type ClientToolResult = z.infer<typeof ClientToolResultSchema>;

/** An empty body is valid — it resumes the turn on whatever is already
 * pending in the session's history (e.g. the [session_start] marker) rather
 * than adding new input, mirroring startTurn's own content/clientToolResult
 * being optional. */
export const PostSessionMessageRequestSchema = z.object({
  content: z.string().min(1).optional(),
  clientToolResult: ClientToolResultSchema.optional()
});
export type PostSessionMessageRequest = z.infer<typeof PostSessionMessageRequestSchema>;

export const ThreadSchema = z.object({
  id: z.number().int(),
  topic: z.string().max(200),
  status: z.enum(['active', 'parked', 'resolved']),
  hypothesis: z.string().max(300).nullable(),
  anchorPly: z.number().int().nonnegative().nullable(),
  anchorFen: z.string().nullable()
});
export type Thread = z.infer<typeof ThreadSchema>;
