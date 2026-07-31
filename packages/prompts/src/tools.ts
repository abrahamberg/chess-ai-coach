import { z } from 'zod';
import { FindingSchema, FocusAreaUpdateSchema, ThreadSchema } from '@chess-coach/shared';

/** architecture §7.1 — parameter schemas for the coach agent's 9 tools. Pure
 * (no execute functions here); apps/api/src/services/coach-tools.ts binds
 * these to real services to build the AI SDK ToolSet. */

/**
 * Standard chess move-pair terminology ("White's move 2", "Black's move
 * 2") instead of a bare ply — a bare ply number is not how PGN moves are
 * named, and asking the model to convert ply <-> move-pair itself in prose
 * ("White's move N is ply 2N-1") reliably produced miscounted navigation.
 * moveNumber 0 with color null addresses the game's starting position.
 */
export const showPositionParameters = z
  .object({
    moveNumber: z.number().int().nonnegative(),
    color: z.enum(['white', 'black']).nullable()
  })
  .refine((value) => (value.moveNumber === 0 ? value.color === null : value.color !== null), {
    message: 'color must be null only when moveNumber is 0 (the game start)'
  });

/** check_position takes the same {moveNumber, color} address as
 * show_position — it just answers with the FEN instead of moving the
 * student's board. */
export const checkPositionParameters = showPositionParameters;

export const annotateBoardParameters = z.object({
  arrows: z.array(z.object({ from: z.string(), to: z.string(), color: z.string() })),
  highlights: z.array(z.object({ square: z.string(), color: z.string() }))
});

export const getEngineAnalysisParameters = z.object({
  fen: z.string(),
  question: z.string()
});

export const getUserProfileParameters = z.object({});

export const recordFindingParameters = FindingSchema;

export const proposeFocusAreaUpdateParameters = FocusAreaUpdateSchema;

export const updateThreadsParameters = z.object({
  threads: z.array(ThreadSchema)
});

export const endSessionParameters = z.object({
  summary: z.string(),
  homework: z.string().nullable()
});

/** design doc §3: coach-authored per-move note, discretionary (same pattern
 * as record_finding — not mandatory every move). */
export const recordMoveNoteParameters = z.object({
  ply: z.number().int().nonnegative(),
  note: z.string().min(1).max(300)
});

/** design doc §4: on-demand deeper lookup for a specific past move. */
export const recallMoveParameters = z.object({
  ply: z.number().int().nonnegative()
});
