import { z } from 'zod';
import { FindingSchema, FocusAreaUpdateSchema } from './finding.js';

export const SessionStatusSchema = z.enum(['active', 'completed', 'paused_no_credits']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionOutcomeSchema = z.object({
  sessionSummary: z.string(),
  homework: z.string().nullable(),
  findings: z.array(FindingSchema).max(10),
  focusAreaUpdates: z.array(FocusAreaUpdateSchema).max(4)
});
export type SessionOutcome = z.infer<typeof SessionOutcomeSchema>;

export const ThreadSchema = z.object({
  id: z.number().int(),
  topic: z.string().max(200),
  status: z.enum(['active', 'parked', 'resolved']),
  hypothesis: z.string().max(300).nullable(),
  anchorPly: z.number().int().nonnegative().nullable(),
  anchorFen: z.string().nullable()
});
export type Thread = z.infer<typeof ThreadSchema>;
