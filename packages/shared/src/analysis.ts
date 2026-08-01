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

/**
 * Rich, single-position analysis (interactive path only — see
 * PositionAnalysisSchema below). Deliberately separate from
 * EngineEval/EngineLine above, which stay lean and unchanged: those still
 * back the whole-game batch pipeline (classifyMoves, DB storage), and this
 * type must never leak extra compute/storage cost onto that path.
 */
export const PieceSymbolSchema = z.enum(['p', 'n', 'b', 'r', 'q', 'k']);
export type PieceSymbolDto = z.infer<typeof PieceSymbolSchema>;

const ColorSchema = z.enum(['white', 'black']);
const PerColorCountSchema = z.object({ white: z.number().int().nonnegative(), black: z.number().int().nonnegative() });

export const PositionAnalysisLineSchema = z.object({
  moveUci: z.string(),
  moveSan: z.string(),
  /** Full principal variation in SAN, this move included — unlike
   * EngineLine, which (for the batch path) only keeps the first move. */
  pvSan: z.array(z.string()),
  cp: z.number().int().nullable(),
  mateIn: z.number().int().nullable()
});
export type PositionAnalysisLine = z.infer<typeof PositionAnalysisLineSchema>;

export const AttackedPieceSchema = z.object({
  square: z.string(),
  piece: PieceSymbolSchema,
  color: ColorSchema,
  attackers: z.number().int().nonnegative(),
  defenders: z.number().int().nonnegative()
});
export type AttackedPieceDto = z.infer<typeof AttackedPieceSchema>;

export const OverloadedDefenderSchema = z.object({
  square: z.string(),
  defending: z.array(z.string())
});

export const ControlledSquaresSchema = z.object({
  square: z.string(),
  piece: PieceSymbolSchema,
  color: ColorSchema,
  squares: z.array(z.string())
});

export const SemiOpenFileSchema = z.object({
  file: z.string(),
  /** The color with no pawns on this file — the side it's open *for*. */
  openFor: ColorSchema
});

export const DoubledPawnFileSchema = z.object({
  file: z.string(),
  color: ColorSchema,
  count: z.number().int().min(2)
});

export const PawnInfoSchema = z.object({
  square: z.string(),
  color: ColorSchema
});

export const TargetsAttackedSchema = z.object({
  from: z.string(),
  piece: PieceSymbolSchema,
  targets: z.array(z.string())
});

export const ForkSchema = z.object({
  square: z.string(),
  piece: PieceSymbolSchema,
  forkedSquares: z.array(z.string())
});

export const CaptureOpportunitySchema = z.object({
  moveSan: z.string(),
  from: z.string(),
  to: z.string(),
  capturedPiece: PieceSymbolSchema,
  favorable: z.boolean()
});

/** Static, engine-independent board features — pure function of a FEN (see
 * packages/chess-analysis's computePositionFeatures). */
export const PositionFeaturesSchema = z.object({
  turn: ColorSchema,
  boardState: z.enum(['none', 'check', 'checkmate', 'stalemate']),
  availableMoves: z.array(z.string()),
  mobility: PerColorCountSchema,
  controlledSquares: z.array(ControlledSquaresSchema),
  piecesUnderAttack: z.array(AttackedPieceSchema),
  hangingPieces: z.array(AttackedPieceSchema),
  underDefendedPieces: z.array(AttackedPieceSchema),
  overloadedDefenders: z.array(OverloadedDefenderSchema),
  centerControlScore: PerColorCountSchema,
  openFiles: z.array(z.string()),
  semiOpenFiles: z.array(SemiOpenFileSchema),
  doubledPawns: z.array(DoubledPawnFileSchema),
  isolatedPawns: z.array(PawnInfoSchema),
  passedPawns: z.array(PawnInfoSchema),
  targetsAttacked: z.array(TargetsAttackedSchema),
  forks: z.array(ForkSchema),
  captureOpportunities: z.array(CaptureOpportunitySchema)
});
export type PositionFeatures = z.infer<typeof PositionFeaturesSchema>;

export const PositionAnalysisSchema = z.object({
  fen: z.string(),
  depth: z.number().int().positive(),
  multiPv: z.number().int().positive(),
  bestMove: z.string().nullable(),
  eval: z.object({ cp: z.number().int().nullable(), mateIn: z.number().int().nullable() }),
  lines: z.array(PositionAnalysisLineSchema),
  /** turn/boardState live here, not duplicated at the top level. */
  features: PositionFeaturesSchema
});
export type PositionAnalysis = z.infer<typeof PositionAnalysisSchema>;
