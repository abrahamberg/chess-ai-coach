import { z } from 'zod';
import { MISTAKE_CATEGORIES } from './index.js';

export const FindingSeveritySchema = z.enum(['minor', 'significant', 'critical']);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingSchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES),
  severity: FindingSeveritySchema,
  ply: z.number().int().nonnegative().nullable(),
  description: z.string(),
  isPositive: z.boolean()
});
export type Finding = z.infer<typeof FindingSchema>;

export const FocusAreaUpdateSchema = z.object({
  category: z.enum(MISTAKE_CATEGORIES),
  action: z.enum(['create', 'progress', 'regress', 'resolve']),
  note: z.string()
});
export type FocusAreaUpdate = z.infer<typeof FocusAreaUpdateSchema>;
