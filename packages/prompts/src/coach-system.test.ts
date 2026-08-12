import { describe, expect, test } from 'vitest';
import { MISTAKE_CATEGORIES, type CoachingPlan } from '@chess-coach/shared';
import { buildCoachSystemPrompt, type CoachPromptInput } from './coach-system.js';

const now = new Date('2026-07-28T12:00:00Z');

const basePlan: CoachingPlan = {
  gameSummary: 'summary',
  openingNote: 'opening',
  themes: ['king_safety'],
  connectionToHistory: 'Second game in a row with a delayed castle.',
  moments: [
    {
      ply: 23,
      kind: 'user_mistake' as const,
      category: 'king_safety' as const,
      whatHappened: 'Pushed g4 in front of the uncastled king.',
      socraticQuestion: 'Before pushing this pawn, where is your king going to live?',
      keyLine: 'O-O Re8 d3 h6',
      revealDepthPlies: 6
    }
  ]
};

function baseInput(overrides: Partial<CoachPromptInput> = {}): CoachPromptInput {
  return {
    user: { displayName: 'Ann', selfAssessment: 'I blunder pieces', sessionCount: 3 },
    band: 'club',
    mode: 'analyze',
    game: {
      whiteName: 'Ann',
      blackName: 'Bob',
      result: '1-0',
      timeControl: '10+0',
      userColor: 'white'
    },
    plan: basePlan,
    focusAreas: [],
    recentFindings: [],
    now,
    ...overrides
  };
}

describe('buildCoachSystemPrompt', () => {
  test('staticPart is byte-identical for two different same-band users', () => {
    const a = buildCoachSystemPrompt(
      baseInput({ user: { displayName: 'Ann', selfAssessment: 'x', sessionCount: 1 } })
    );
    const b = buildCoachSystemPrompt(
      baseInput({
        user: { displayName: 'Zed', selfAssessment: 'y', sessionCount: 40 },
        focusAreas: [
          {
            category: 'hanging_piece',
            status: 'active',
            note: 'note',
            evidenceCount: 1,
            lastSeenAt: now
          }
        ]
      })
    );

    expect(a.staticPart).toBe(b.staticPart);
  });

  test('staticPart differs across bands (revealDepthPlies is band-calibrated)', () => {
    const novice = buildCoachSystemPrompt(baseInput({ band: 'novice' }));
    const advanced = buildCoachSystemPrompt(baseInput({ band: 'advanced' }));

    expect(novice.staticPart).not.toBe(advanced.staticPart);
  });

  test('staticPart contains all 13 mistake categories', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    for (const category of MISTAKE_CATEGORIES) {
      expect(staticPart).toContain(category);
    }
  });

  test('staticPart tells the coach to address positions with show_position\'s {moveNumber, color} directly, with no ply arithmetic', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('standard chess move-pair numbering');
    expect(staticPart).not.toContain('ply 2N-1');
    expect(staticPart).not.toContain('ply 2N');
  });

  test('staticPart requires the coach to state the best move and why before leaving a moment, and to ask before advancing to the next one', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain("make sure you've actually told them the best move and why");
    expect(staticPart).toContain('ask if they\'re ready to move on');
    expect(staticPart).toContain('never show_position to the next moment unprompted');
  });

  // The coach used to discuss a move without navigating to it first, then
  // reason from whatever "## Current position" still held — the PREVIOUS
  // move's analysis. show_position is what advances currentPly and so what
  // rebuilds that block (coach-agent-client-tool-result.ts), but the prompt
  // only ever described it as moving the student's board, which reads as
  // cosmetic. Both halves of the causal link have to stay stated.
  test('staticPart ties show_position to loading the move\'s own analysis, and warns that skipping it leaves the previous move\'s analysis in view', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('wait for its result before you speak about the move');
    expect(staticPart).toContain("loads that move's own engine analysis");
    expect(staticPart).toContain("the analysis you can see is still the PREVIOUS move's");
    expect(staticPart).toContain('let the result come back before you discuss it');
  });

  // A hypothetical position is not in the game's PGN, so getPositionAtPly
  // never covers it and nothing analyzes it for the coach — the one case
  // where get_engine_analysis is the only way to see the position.
  test('staticPart tells the coach a hypothetical position is never analyzed for it, and to pass hypothetical_line\'s fen to get_engine_analysis', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('no analysis of it ever arrives on its own');
    expect(staticPart).toContain('pass the fen hypothetical_line returned to get_engine_analysis');
    expect(staticPart).toContain("never carry the real position's evaluation into the line");
  });

  test('staticPart tells the coach show_position\'s result carries the real fen and never to invent one itself', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('check_position');
    expect(staticPart).toContain('NEVER invent or reconstruct a FEN from memory');
  });

  test('staticPart tells the coach to write plain prose with no markdown and to use standard move-number notation, not its own separator', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('no markdown');
    expect(staticPart).toContain('no **bold**');
    expect(staticPart).toContain('never invent your own separator like "18-Nf3"');
  });

  test('staticPart teaches the coach to read a student-drawn [e2-e4] arrow token as their proposed move, without ever quoting the bracket syntax to the student', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('[e2-e4]');
    expect(staticPart).toContain('never mention the bracket syntax');
  });

  test('staticPart never contains user-identifying data', () => {
    const { staticPart } = buildCoachSystemPrompt(
      baseInput({ user: { displayName: 'VeryUniqueName42', selfAssessment: 'x', sessionCount: 1 } })
    );
    expect(staticPart).not.toContain('VeryUniqueName42');
  });

  test('dynamicPart contains the display name, focus areas, and plan moments', () => {
    const { dynamicPart } = buildCoachSystemPrompt(
      baseInput({
        user: { displayName: 'Ann', selfAssessment: 'I blunder pieces', sessionCount: 3 },
        focusAreas: [
          {
            category: 'hanging_piece',
            status: 'active',
            note: 'checks captures too slowly',
            evidenceCount: 2,
            lastSeenAt: now
          }
        ]
      })
    );

    expect(dynamicPart).toContain('Ann');
    expect(dynamicPart).toContain('checks captures too slowly');
    expect(dynamicPart).toContain('Before pushing this pawn, where is your king going to live?');
    expect(dynamicPart).toContain('O-O Re8 d3 h6');
  });

  test('empty focus areas render the "(none yet…)" fallback in dynamicPart', () => {
    const { dynamicPart } = buildCoachSystemPrompt(baseInput({ focusAreas: [] }));
    expect(dynamicPart).toContain('none yet');
  });

  test('dynamicPart is identical across repeated calls with the same input (session-stable)', () => {
    const input = baseInput();
    const first = buildCoachSystemPrompt(input);
    const second = buildCoachSystemPrompt(input);
    expect(first.dynamicPart).toBe(second.dynamicPart);
  });

  test('staticPart tells the coach about record_move_note and recall_move', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('record_move_note');
    expect(staticPart).toContain('recall_move');
  });

  test('staticPart pushes record_move_note as the reliable default, not an occasional extra', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('treat calling this yourself');
    expect(staticPart).not.toContain('not mechanically every single time');
  });

  test('staticPart tells the coach the thread ledger is not durable memory, and to bridge an anchored thread to record_move_note before it leaves the ledger', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain("THE LEDGER ISN'T DURABLE MEMORY");
    expect(staticPart).toContain('anchorPly/anchorFen');
  });

  test('staticPart tells the coach to call show_position/check_position before discussing ANY position, not only prepared moments', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('GET THE BOARD THERE FIRST');
  });

  test('staticPart tells the coach to put any move more than one ply from the current position on the board, not in prose', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('more than one ply from the current position');
  });

  test('analyze-mode staticPart tells the coach about reveal_move\'s preview/full modes', () => {
    const { staticPart } = buildCoachSystemPrompt(baseInput());
    expect(staticPart).toContain('reveal_move');
    expect(staticPart).toContain('"preview"');
    expect(staticPart).toContain('"full"');
  });

  describe('engine visibility (always on, no per-user toggle)', () => {
    test('staticPart tells the coach it may cite raw evaluations and lines, for every student', () => {
      const { staticPart } = buildCoachSystemPrompt(baseInput());
      expect(staticPart).not.toContain('ENGINE IS BACKSTAGE');
      expect(staticPart).toContain('may cite evaluations, best lines');
    });

    test('staticPart is byte-identical regardless of user/game — engine visibility is no longer per-user', () => {
      const a = buildCoachSystemPrompt(baseInput());
      const b = buildCoachSystemPrompt(baseInput({ user: { displayName: 'Zed', selfAssessment: 'y', sessionCount: 40 } }));
      expect(a.staticPart).toBe(b.staticPart);
    });
  });

  describe('play mode (architecture §14)', () => {
    function basePlayInput(overrides: Partial<CoachPromptInput> = {}): CoachPromptInput {
      return baseInput({ mode: 'play', plan: null, ...overrides });
    }

    test('mode: "analyze" (default input) never mentions any play-mode tool or session-flow content — regression guard against the two modes bleeding into each other', () => {
      const { staticPart } = buildCoachSystemPrompt(baseInput());
      expect(staticPart).not.toContain('get_candidate_moves');
      expect(staticPart).not.toContain('play_coach_move');
      expect(staticPart).not.toContain('undo_last_move');
      expect(staticPart).not.toContain('Choosing your own move');
    });

    test('mode: "play" staticPart includes the 3 play tools and the play-mode session flow instead of the analyze-mode one', () => {
      const { staticPart } = buildCoachSystemPrompt(basePlayInput());
      expect(staticPart).toContain('get_candidate_moves');
      expect(staticPart).toContain('play_coach_move');
      expect(staticPart).toContain('undo_last_move');
      expect(staticPart).toContain('Choosing your own move');
      expect(staticPart).not.toContain('preparation moments');
    });

    test('mode: "play" staticPart still contains every analyze-mode tool too (get_candidate_moves etc. are additive, not a replacement)', () => {
      const { staticPart } = buildCoachSystemPrompt(basePlayInput());
      expect(staticPart).toContain('show_position');
      expect(staticPart).toContain('record_move_note');
    });

    // reveal_move is analyze-mode only (a live move just played has nothing
    // to preview or reveal) — it must never appear in the play-mode prompt,
    // in either the tool list or howYouRunTheSession's mode-conditional text.
    test('mode: "play" staticPart never mentions reveal_move', () => {
      const { staticPart } = buildCoachSystemPrompt(basePlayInput());
      expect(staticPart).not.toContain('reveal_move');
    });

    // Item 3: "get the board there first" used to live only in analyze
    // mode's SESSION_FLOW; promoting it into the shared howYouRunTheSession
    // means play mode now gets it too.
    test('mode: "play" staticPart also contains "let the result come back before you discuss it", now that the rule is shared across both modes', () => {
      const { staticPart } = buildCoachSystemPrompt(basePlayInput());
      expect(staticPart).toContain('let the result come back before you discuss it');
    });

    test('mode: "play" dynamicPart states the student\'s and coach\'s colors and never claims a preparation plan exists', () => {
      const { dynamicPart } = buildCoachSystemPrompt(basePlayInput({ game: { ...baseInput().game, userColor: 'black' } }));
      expect(dynamicPart).toContain('they are black, you are white');
      expect(dynamicPart).not.toContain('preparation notes');
    });

    test('mode: "play" with plan: null does not throw (plan is only required in analyze mode)', () => {
      expect(() => buildCoachSystemPrompt(basePlayInput())).not.toThrow();
    });

    test('mode: "analyze" with plan: null throws — analyze mode has no other source for the walkthrough plan', () => {
      expect(() => buildCoachSystemPrompt(baseInput({ plan: null }))).toThrow();
    });
  });
});
