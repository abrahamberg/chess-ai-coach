import { ClassifiedMoveSchema, MoveQualitySchema } from '@chess-coach/shared';
import { z } from 'zod';

export const SessionMessageSchema = z.object({
  id: z.coerce.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.unknown()
});

// .default('analyze') so older fixtures/responses without a mode field
// (pre-Phase-8 data) still parse as today's only mode, rather than failing.
export const SessionDetailSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  status: z.enum(['active', 'completed', 'paused_no_credits', 'abandoned']),
  mode: z.enum(['analyze', 'play']).default('analyze'),
  /** What the conversation is actually about — used to seed initialPly on
   * reopen (useSessionPageData.ts), instead of scanning the transcript for
   * the last show_position (which could be a trailing flashback). */
  subjectPly: z.number(),
  summary: z.string().nullable(),
  homework: z.string().nullable(),
  messages: z.array(SessionMessageSchema)
});

export const ResetSessionResponseSchema = z.object({ id: z.string() });

/** Play mode's live equivalent of ClassifiedMoveSchema (GameMoveQualityRow),
 * trimmed to the fields the board/eval-bar/move-strip actually render —
 * unlike ClassifiedMoveSchema it has no isUserMove/hangsPiece, since nothing
 * downstream reads either (see liveMoveQualities.ts, which fills them in
 * with defaults when merging this into ClassifiedMoveDto's shape). */
export const LiveMoveQualitySchema = z.object({
  ply: z.number().int().nonnegative(),
  moveSan: z.string(),
  mover: z.enum(['white', 'black']),
  quality: MoveQualitySchema,
  cpLoss: z.number().int().nonnegative(),
  bestLineSan: z.array(z.string()),
  evalAfterCp: z.number().int()
});
export type LiveMoveQuality = z.infer<typeof LiveMoveQualitySchema>;

export const GameDetailSchema = z.object({
  id: z.string(),
  pgn: z.string(),
  userColor: z.enum(['white', 'black']),
  whiteName: z.string().nullable(),
  blackName: z.string().nullable(),
  result: z.string().nullable(),
  classifiedMoves: z.array(ClassifiedMoveSchema).nullable(),
  liveMoveQualities: z.array(LiveMoveQualitySchema).nullable().default(null)
});

/** POST /api/sessions/:id/play-move's response (architecture §14). */
export const CommitPlayMoveResponseSchema = z.object({
  fen: z.string(),
  san: z.string(),
  ply: z.number().int().nonnegative(),
  quality: MoveQualitySchema
});
