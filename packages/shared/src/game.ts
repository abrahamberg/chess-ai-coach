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

export const ImportGameResponseSchema = z.object({
  gameId: z.string().min(1),
  analysisId: z.string().min(1)
});
export type ImportGameResponse = z.infer<typeof ImportGameResponseSchema>;

/** design.md §4.2: "From Lichess" picker row — same shape ImportGameRequestSchema
 * needs (pgn, source: 'lichess') plus display fields for the row itself. */
export const LichessRecentGameSchema = z.object({
  id: z.string(),
  pgn: z.string(),
  whiteName: z.string().nullable(),
  blackName: z.string().nullable(),
  result: z.string().nullable(),
  timeControl: z.string().nullable(),
  playedAt: z.string().nullable()
});
export type LichessRecentGame = z.infer<typeof LichessRecentGameSchema>;

export const LichessRecentGamesResponseSchema = z.array(LichessRecentGameSchema);
export type LichessRecentGamesResponse = z.infer<typeof LichessRecentGamesResponseSchema>;
