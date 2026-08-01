import { z } from 'zod';
import { FindingSchema, FocusAreaUpdateSchema, ThreadSchema } from '@chess-coach/shared';

/** architecture §7.1 — parameter schemas for the coach agent's 11 tools. Pure
 * (no execute functions here); apps/api/src/services/coach-tools.ts binds
 * these to real services to build the AI SDK ToolSet. */

/**
 * Standard chess move-pair terminology ("White's move 2", "Black's move
 * 2") instead of a bare ply — a bare ply number is not how PGN moves are
 * named, and asking the model to convert ply <-> move-pair itself in prose
 * ("White's move N is ply 2N-1") reliably produced miscounted navigation.
 * moveNumber 0 with color null addresses the game's starting position.
 * Shared by every tool that addresses a move in this game (show_position,
 * check_position, record_move_note, recall_move) — never a bare ply,
 * anywhere in the tool surface.
 */
const moveAddressShape = {
  moveNumber: z.number().int().nonnegative(),
  color: z.enum(['white', 'black']).nullable()
};

function refineMoveAddress<T extends { moveNumber: number; color: 'white' | 'black' | null }>(value: T): boolean {
  return value.moveNumber === 0 ? value.color === null : value.color !== null;
}

const MOVE_ADDRESS_REFINEMENT_MESSAGE = 'color must be null only when moveNumber is 0 (the game start)';

export const showPositionParameters = z
  .object(moveAddressShape)
  .refine(refineMoveAddress, { message: MOVE_ADDRESS_REFINEMENT_MESSAGE });

/** check_position takes the same {moveNumber, color} address as
 * show_position — it just answers with the FEN instead of moving the
 * student's board. */
export const checkPositionParameters = showPositionParameters;

export const annotateBoardParameters = z.object({
  arrows: z.array(z.object({ from: z.string(), to: z.string(), color: z.string() })),
  highlights: z.array(z.object({ square: z.string(), color: z.string() }))
});

export const getEngineAnalysisParameters = z.object({
  fen: z.string()
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
 * as record_finding — not mandatory every move). Addressed the same way as
 * show_position/check_position ({ moveNumber, color }) — never a bare ply
 * (final review #1): every other context surface speaks move-pair
 * terminology, and a bare ply here was the one place the model was
 * silently likely to miscount. */
export const recordMoveNoteParameters = z
  .object({ ...moveAddressShape, note: z.string().min(1).max(300) })
  .refine(refineMoveAddress, { message: MOVE_ADDRESS_REFINEMENT_MESSAGE });

/** design doc §4: on-demand deeper lookup for a specific past move, same
 * { moveNumber, color } address as show_position/check_position (final
 * review #1). */
export const recallMoveParameters = showPositionParameters;
