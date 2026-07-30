import { z } from 'zod';

export const AnalysisStatusSchema = z.enum([
  'queued',
  'engine_running',
  'planning',
  'ready',
  'failed'
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const EngineLineSchema = z.object({
  moveUci: z.string(),
  moveSan: z.string(),
  cp: z.number().int().nullable(),
  mateIn: z.number().int().nullable()
});
export type EngineLine = z.infer<typeof EngineLineSchema>;

export const EngineEvalSchema = z.object({
  ply: z.number().int().nonnegative(),
  fen: z.string(),
  depth: z.number().int().positive(),
  lines: z.array(EngineLineSchema).min(1)
});
export type EngineEval = z.infer<typeof EngineEvalSchema>;

export const MOVE_QUALITIES = ['brilliant', 'best', 'good', 'interesting', 'dubious', 'mistake', 'miss', 'blunder'] as const;
export type MoveQuality = (typeof MOVE_QUALITIES)[number];

/** Chess.com/lichess-style NAG symbols for each quality tier. */
export const MOVE_QUALITY_SYMBOLS: Record<MoveQuality, string> = {
  brilliant: '!!',
  best: '★',
  good: '!',
  interesting: '!?',
  dubious: '?!',
  mistake: '?',
  miss: '✕',
  blunder: '??'
};

export const MoveQualitySchema = z.enum(MOVE_QUALITIES);

export const ClassifiedMoveSchema = z.object({
  ply: z.number().int().nonnegative(),
  moveSan: z.string(),
  mover: z.enum(['white', 'black']),
  isUserMove: z.boolean(),
  cpLoss: z.number().int().nonnegative(),
  quality: MoveQualitySchema,
  bestLineSan: z.array(z.string()),
  evalAfterCp: z.number().int(),
  hangsPiece: z.boolean().default(false)
});
export type ClassifiedMoveDto = z.infer<typeof ClassifiedMoveSchema>;

export const AnalyzeGameRequestSchema = z.object({
  fens: z.array(z.string()).min(1),
  depth: z.number().int().positive().optional(),
  multiPv: z.number().int().positive().optional()
});
export type AnalyzeGameRequest = z.infer<typeof AnalyzeGameRequestSchema>;

export const AnalyzePositionRequestSchema = z.object({
  fen: z.string(),
  depth: z.number().int().positive().optional(),
  multiPv: z.number().int().positive().optional()
});
export type AnalyzePositionRequest = z.infer<typeof AnalyzePositionRequestSchema>;
