import { z } from 'zod';
import { AnalysisStatusSchema } from './analysis.js';

export const GameSourceSchema = z.enum(['paste', 'upload', 'lichess', 'coach_play']);
export type GameSource = z.infer<typeof GameSourceSchema>;

/** architecture §14: 'coach_play' is set only by createPlaySession
 * (server-side, POST /api/sessions/play) — never a client-supplied import
 * source, so ImportGameRequestSchema below deliberately excludes it. */
export const ImportableGameSourceSchema = z.enum(['paste', 'upload', 'lichess']);
export type ImportableGameSource = z.infer<typeof ImportableGameSourceSchema>;

export const PlayerColorSchema = z.enum(['white', 'black']);
export type PlayerColor = z.infer<typeof PlayerColorSchema>;

export const ImportGameRequestSchema = z.object({
  pgn: z.string().min(1),
  source: ImportableGameSourceSchema,
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

/** design.md §4.1: Games (home) list row — enough to render players/result/status
 * chip without a follow-up request per row. */
export const GameListItemSchema = z.object({
  id: z.string(),
  source: GameSourceSchema,
  userColor: PlayerColorSchema,
  whiteName: z.string().nullable(),
  blackName: z.string().nullable(),
  result: z.string().nullable(),
  timeControl: z.string().nullable(),
  playedAt: z.string().nullable(),
  createdAt: z.string(),
  analysisStatus: AnalysisStatusSchema.nullable(),
  /** architecture §14: only ever set for source === 'coach_play' — the id of
   * its still-resumable session, so the Games list can link straight back in
   * without going through analyze mode's POST /api/sessions (which gates on
   * an `analyses` row a play-mode game never has). Null once that session has
   * ended (completed/abandoned) or, for analyze-mode games, always. */
  sessionId: z.string().nullable()
});
export type GameListItem = z.infer<typeof GameListItemSchema>;

export const GameListResponseSchema = z.array(GameListItemSchema);
export type GameListResponse = z.infer<typeof GameListResponseSchema>;
