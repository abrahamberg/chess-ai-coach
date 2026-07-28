import { describe, expect, test } from 'vitest';
import { MISTAKE_CATEGORIES } from '@chess-coach/shared';
import { buildSummarizerMessages, type SummarizerPromptInput } from './progress-summarizer.js';

const now = new Date('2026-07-28T12:00:00Z');

function baseInput(overrides: Partial<SummarizerPromptInput> = {}): SummarizerPromptInput {
  return {
    band: 'club',
    focusAreas: [],
    recentFindings: [],
    selfAssessment: 'I blunder pieces',
    plan: {
      gameSummary: 'summary',
      openingNote: 'opening',
      themes: ['king_safety'],
      connectionToHistory: 'connection',
      moments: [
        {
          ply: 23,
          kind: 'user_mistake',
          category: 'king_safety',
          whatHappened: 'Pushed g4 in front of the uncastled king.',
          socraticQuestion: 'Where does your king live?',
          keyLine: 'O-O Re8 d3 h6',
          revealDepthPlies: 6
        }
      ]
    },
    transcript: 'coach: hello\nstudent: hi',
    recordedFindings: '(none recorded live)',
    now,
    ...overrides
  };
}

describe('buildSummarizerMessages', () => {
  test('system prompt lists all 13 categories and forbids inventing new ones', () => {
    const { system } = buildSummarizerMessages(baseInput());
    for (const category of MISTAKE_CATEGORIES) {
      expect(system).toContain(category);
    }
    expect(system).toContain('ONLY these');
  });

  test('system prompt explains the focus-area state machine and the 3-active cap', () => {
    const { system } = buildSummarizerMessages(baseInput());
    expect(system).toContain('3-active cap');
  });

  test('user message includes the transcript and already-recorded findings', () => {
    const { user } = buildSummarizerMessages(
      baseInput({ transcript: 'UNIQUE_TRANSCRIPT_MARKER', recordedFindings: 'UNIQUE_FINDINGS_MARKER' })
    );
    expect(user).toContain('UNIQUE_TRANSCRIPT_MARKER');
    expect(user).toContain('UNIQUE_FINDINGS_MARKER');
  });

  test('empty focus areas render the "(none yet…)" fallback in the user message', () => {
    const { user } = buildSummarizerMessages(baseInput({ focusAreas: [] }));
    expect(user).toContain('none yet');
  });
});
