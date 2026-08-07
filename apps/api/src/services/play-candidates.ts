import { CANDIDATE_BRIEFING_SYSTEM_PROMPT } from '@chess-coach/prompts';
import { annotateCandidateMoves, type CandidateMoveAnnotation } from '@chess-coach/chess-analysis';
import type { PositionAnalysis } from '@chess-coach/shared';
import type { SummarizeFn } from './session-context.js';

export interface CandidateBriefingDependencies {
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
  callLightModel: SummarizeFn;
}

interface CandidateForDigest extends CandidateMoveAnnotation {
  cp: number | null;
  mateIn: number | null;
}

/**
 * get_candidate_moves tool (architecture.md §14): surfaces the engine's
 * sound candidate replies annotated with their concrete tactical
 * consequences, cross-referenced against the student's active focus areas
 * — informational only, never a pick. Raw engine/tactic JSON is digested by
 * a light-tier subagent (AGENTS.md golden rule 8) before it ever reaches
 * the standard-tier coach's context; the coach decides what to play itself
 * via a separate play_coach_move call.
 */
export async function getCandidateMoveBriefing(
  deps: CandidateBriefingDependencies,
  fen: string,
  focusAreas: string[]
): Promise<string> {
  const analysis = await deps.analyzePosition(fen);
  const annotations = annotateCandidateMoves(
    fen,
    analysis.lines.map((line) => line.moveSan)
  );

  const candidates: CandidateForDigest[] = annotations.map((annotation) => {
    const line = analysis.lines.find((candidate) => candidate.moveSan === annotation.moveSan);
    return { ...annotation, cp: line?.cp ?? null, mateIn: line?.mateIn ?? null };
  });

  const user = `FOCUS AREAS: ${focusAreas.length > 0 ? focusAreas.join(', ') : 'none'}\n\nCANDIDATES:\n${JSON.stringify(candidates)}`;
  return deps.callLightModel({ system: CANDIDATE_BRIEFING_SYSTEM_PROMPT, user });
}
