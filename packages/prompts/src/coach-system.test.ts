import { describe, expect, test } from 'vitest';
import { MISTAKE_CATEGORIES } from '@chess-coach/shared';
import { buildCoachSystemPrompt, type CoachPromptInput } from './coach-system.js';

const now = new Date('2026-07-28T12:00:00Z');

const basePlan = {
  gameSummary: 'summary',
  openingNote: 'opening',
  themes: ['king_safety'] as CoachPromptInput['plan']['themes'],
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
});
