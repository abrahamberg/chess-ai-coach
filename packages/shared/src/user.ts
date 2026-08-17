import { z } from 'zod';
import { COACH_PERSONAS, ENGINE_MODES, RATING_BANDS } from './constants.js';

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  ratingBand: z.enum(RATING_BANDS),
  engineMode: z.enum(ENGINE_MODES),
  coachPersona: z.enum(COACH_PERSONAS),
  lichessUsername: z.string().nullable(),
  chesscomUsername: z.string().nullable(),
  selfAssessment: z.string().nullable(),
  creditBalance: z.number().int()
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UpdateUserProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1, 'Nickname cannot be empty').max(60, 'Nickname must be 60 characters or fewer').optional(),
  ratingBand: z.enum(RATING_BANDS).optional(),
  engineMode: z.enum(ENGINE_MODES).optional(),
  coachPersona: z.enum(COACH_PERSONAS).optional(),
  lichessUsername: z.string().nullable().optional(),
  chesscomUsername: z.string().nullable().optional(),
  selfAssessment: z.string().nullable().optional()
});
export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileRequestSchema>;
