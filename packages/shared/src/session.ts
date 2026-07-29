import { z } from 'zod';
import { FindingSchema, FocusAreaUpdateSchema } from './finding.js';

export const SessionStatusSchema = z.enum(['active', 'completed', 'paused_no_credits', 'abandoned']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

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
