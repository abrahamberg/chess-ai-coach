import { describe, expect, test } from 'vitest';
import { COACH_TOOL_SPECS } from './tools.js';
import {
  getCandidateMovesParameters,
  PLAY_COACH_TOOL_SPECS,
  PLAY_TOOL_SPECS,
  playCoachMoveParameters,
  playCoachToolDescription,
  undoLastMoveParameters
} from './tools-play.js';

describe('play mode tool parameter schemas (architecture §14)', () => {
  test('get_candidate_moves: { fen }', () => {
    expect(getCandidateMovesParameters.safeParse({ fen: 'startpos' }).success).toBe(true);
    expect(getCandidateMovesParameters.safeParse({}).success).toBe(false);
  });

  test('play_coach_move: { san }, rejects an empty string', () => {
    expect(playCoachMoveParameters.safeParse({ san: 'Nf3' }).success).toBe(true);
    expect(playCoachMoveParameters.safeParse({ san: '' }).success).toBe(false);
    expect(playCoachMoveParameters.safeParse({}).success).toBe(false);
  });

  test('undo_last_move: {}', () => {
    expect(undoLastMoveParameters.safeParse({}).success).toBe(true);
  });
});

describe('PLAY_COACH_TOOL_SPECS', () => {
  test('is every analyze-mode spec except reveal_move, followed by the 3 play-mode specs, in order', () => {
    const analyzeModeSpecsExcludingRevealMove = COACH_TOOL_SPECS.filter((spec) => spec.name !== 'reveal_move');
    expect(PLAY_COACH_TOOL_SPECS.slice(0, analyzeModeSpecsExcludingRevealMove.length)).toEqual(
      analyzeModeSpecsExcludingRevealMove
    );
    expect(PLAY_COACH_TOOL_SPECS.slice(analyzeModeSpecsExcludingRevealMove.length)).toEqual(PLAY_TOOL_SPECS);
  });

  test('excludes reveal_move — a live move just played has nothing to preview or reveal', () => {
    expect(PLAY_COACH_TOOL_SPECS.some((spec) => spec.name === 'reveal_move')).toBe(false);
  });

  test('each play tool has a registered, non-empty description', () => {
    for (const name of ['get_candidate_moves', 'play_coach_move', 'undo_last_move']) {
      expect(playCoachToolDescription(name).length).toBeGreaterThan(0);
    }
  });

  test('throws for an unregistered tool name', () => {
    expect(() => playCoachToolDescription('not_a_tool')).toThrow();
  });
});
