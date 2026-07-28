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

export const MOVE_QUALITIES = ['good', 'inaccuracy', 'mistake', 'blunder'] as const;
export type MoveQuality = (typeof MOVE_QUALITIES)[number];

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
