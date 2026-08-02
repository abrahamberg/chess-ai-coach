import { ClassifiedMoveSchema } from '@chess-coach/shared';
import { z } from 'zod';

export const SessionMessageSchema = z.object({
  id: z.coerce.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.unknown()
});

export const SessionDetailSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  status: z.enum(['active', 'completed', 'paused_no_credits', 'abandoned']),
  summary: z.string().nullable(),
  homework: z.string().nullable(),
  messages: z.array(SessionMessageSchema)
});

export const ResetSessionResponseSchema = z.object({ id: z.string() });

export const GameDetailSchema = z.object({
  id: z.string(),
  pgn: z.string(),
  userColor: z.enum(['white', 'black']),
  whiteName: z.string().nullable(),
  blackName: z.string().nullable(),
  result: z.string().nullable(),
  classifiedMoves: z.array(ClassifiedMoveSchema).nullable()
});
