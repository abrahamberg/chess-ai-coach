import { z } from 'zod';
import { MISTAKE_CATEGORIES } from './index.js';
import { PlayerColorSchema } from './game.js';

export const FocusAreaSummarySchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES),
  status: z.enum(['active', 'improving', 'resolved']),
  note: z.string(),
  evidenceCount: z.number().int(),
  lastSeenAt: z.string()
});
export type FocusAreaSummary = z.infer<typeof FocusAreaSummarySchema>;

export const MistakeTrendSchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES),
  last5: z.number().int().nonnegative(),
  last20: z.number().int().nonnegative()
});
export type MistakeTrend = z.infer<typeof MistakeTrendSchema>;

export const SessionHistoryEntrySchema = z.object({
  sessionId: z.string(),
  gameId: z.string(),
  startedAt: z.string(),
  whiteName: z.string().nullable(),
  blackName: z.string().nullable(),
  userColor: PlayerColorSchema,
  result: z.string().nullable(),
  summary: z.string().nullable(),
  homework: z.string().nullable()
});
export type SessionHistoryEntry = z.infer<typeof SessionHistoryEntrySchema>;

export const DashboardResponseSchema = z.object({
  focusAreas: z.object({
    active: z.array(FocusAreaSummarySchema),
    resolved: z.array(FocusAreaSummarySchema)
  }),
  mistakeTrends: z.array(MistakeTrendSchema),
  sessionHistory: z.array(SessionHistoryEntrySchema)
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
