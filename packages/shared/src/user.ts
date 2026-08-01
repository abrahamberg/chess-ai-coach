import { z } from 'zod';
import { RATING_BANDS } from './constants.js';

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  ratingBand: z.enum(RATING_BANDS),
  lichessUsername: z.string().nullable(),
  chesscomUsername: z.string().nullable(),
  selfAssessment: z.string().nullable(),
  /** Opt-in override of the default "engine invisible" experience — see
   * docs/design.md principle 4. Defaults to false server-side. */
  showEngineAnalysis: z.boolean(),
  creditBalance: z.number().int()
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UpdateUserProfileRequestSchema = z.object({
  ratingBand: z.enum(RATING_BANDS).optional(),
  lichessUsername: z.string().nullable().optional(),
  chesscomUsername: z.string().nullable().optional(),
  selfAssessment: z.string().nullable().optional(),
  showEngineAnalysis: z.boolean().optional()
});
export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileRequestSchema>;
