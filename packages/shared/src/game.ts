import { z } from 'zod';

export const GameSourceSchema = z.enum(['paste', 'upload', 'lichess']);
export type GameSource = z.infer<typeof GameSourceSchema>;

export const PlayerColorSchema = z.enum(['white', 'black']);
export type PlayerColor = z.infer<typeof PlayerColorSchema>;

export const ImportGameRequestSchema = z.object({
  pgn: z.string().min(1),
  source: GameSourceSchema,
  userColor: PlayerColorSchema.optional()
});
export type ImportGameRequest = z.infer<typeof ImportGameRequestSchema>;
