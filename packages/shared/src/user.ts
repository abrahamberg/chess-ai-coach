import { z } from 'zod';
import { RATING_BANDS } from './index.js';

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  ratingBand: z.enum(RATING_BANDS),
  lichessUsername: z.string().nullable(),
  chesscomUsername: z.string().nullable(),
  selfAssessment: z.string().nullable(),
  creditBalance: z.number().int()
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UpdateUserProfileRequestSchema = z.object({
  ratingBand: z.enum(RATING_BANDS).optional(),
  lichessUsername: z.string().nullable().optional(),
  chesscomUsername: z.string().nullable().optional(),
  selfAssessment: z.string().nullable().optional()
});
export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileRequestSchema>;
