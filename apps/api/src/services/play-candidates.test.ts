import { describe, expect, test, vi } from 'vitest';
import type { PositionAnalysis } from '@chess-coach/shared';
import { getCandidateMoveBriefing } from './play-candidates.js';

const START_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

function positionAnalysisFixture(): PositionAnalysis {
  return {
    fen: START_FEN,
    depth: 18,
    multiPv: 2,
    bestMove: 'Bb5',
    eval: { cp: 35, mateIn: null },
    lines: [
      { moveUci: 'f1b5', moveSan: 'Bb5', pvSan: ['Bb5', 'a6', 'Ba4'], cp: 35, mateIn: null },
      { moveUci: 'f1c4', moveSan: 'Bc4', pvSan: ['Bc4', 'Bc5'], cp: 20, mateIn: null }
    ],
    features: {
      turn: 'white',
      boardState: 'none',
      availableMoves: ['Bb5', 'Bc4'],
      mobility: { white: 20, black: 20 },
      controlledSquares: [],
      piecesUnderAttack: [],
      hangingPieces: [],
      underDefendedPieces: [],
      overloadedDefenders: [],
      centerControlScore: { white: 2, black: 2 },
      openFiles: [],
      semiOpenFiles: [],
      doubledPawns: [],
      isolatedPawns: [],
      passedPawns: [],
      targetsAttacked: [],
      forks: [],
      captureOpportunities: []
    }
  };
}

describe('getCandidateMoveBriefing', () => {
  test('digests engine lines + tactical annotations via the light model, never exposing raw JSON as its return value', async () => {
    const analyzePosition = vi.fn().mockResolvedValue(positionAnalysisFixture());
    const callLightModel = vi.fn().mockResolvedValue('Bb5 is the sound choice; Bc4 also fine.');

    const result = await getCandidateMoveBriefing({ analyzePosition, callLightModel }, START_FEN, ['missed_tactic']);

    expect(result).toBe('Bb5 is the sound choice; Bc4 also fine.');
    expect(analyzePosition).toHaveBeenCalledWith(START_FEN);
    expect(callLightModel).toHaveBeenCalledTimes(1);
    const call = callLightModel.mock.calls[0]?.[0] as { system: string; user: string };
    expect(call.system).toContain('candidate');
    expect(call.user).toContain('missed_tactic');
    expect(call.user).toContain('Bb5');
    expect(call.user).toContain('Bc4');
  });

  test('renders "none" for focus areas when the student has none recorded yet', async () => {
    const analyzePosition = vi.fn().mockResolvedValue(positionAnalysisFixture());
    const callLightModel = vi.fn().mockResolvedValue('brief');

    await getCandidateMoveBriefing({ analyzePosition, callLightModel }, START_FEN, []);

    const call = callLightModel.mock.calls[0]?.[0] as { system: string; user: string };
    expect(call.user).toContain('FOCUS AREAS: none');
  });
});
