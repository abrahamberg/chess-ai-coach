import { z } from 'zod';
import { FindingSchema, FocusAreaUpdateSchema, ThreadSchema } from '@chess-coach/shared';

/** architecture §7.1 — parameter schemas for the coach agent's 8 tools. Pure
 * (no execute functions here); apps/api/src/services/coach-tools.ts binds
 * these to real services to build the AI SDK ToolSet. */

export const showPositionParameters = z.object({
  ply: z.number().int().nonnegative()
});

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
