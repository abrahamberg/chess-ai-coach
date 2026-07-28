import { z } from 'zod';
import { MISTAKE_CATEGORIES } from './constants.js';

export const MomentKindSchema = z.enum([
  'user_mistake',
  'missed_chance',
  'turning_point',
  'instructive'
]);
export type MomentKind = z.infer<typeof MomentKindSchema>;

export const CoachingMomentSchema = z.object({
  ply: z.number().int().nonnegative(),
  kind: MomentKindSchema,
  category: z.enum(MISTAKE_CATEGORIES).nullable(),
  whatHappened: z.string(),
  socraticQuestion: z.string(),
  keyLine: z.string(),
  revealDepthPlies: z.number().int().positive()
});
export type CoachingMoment = z.infer<typeof CoachingMomentSchema>;

export const CoachingPlanSchema = z.object({
  gameSummary: z.string(),
  openingNote: z.string(),
  themes: z.array(z.enum(MISTAKE_CATEGORIES)).max(3),
  connectionToHistory: z.string(),
  moments: z.array(CoachingMomentSchema).min(1).max(8)
});
export type CoachingPlan = z.infer<typeof CoachingPlanSchema>;
