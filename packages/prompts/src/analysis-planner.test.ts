import { describe, expect, test } from 'vitest';
import { MISTAKE_CATEGORIES } from '@chess-coach/shared';
import type { ClassifiedMove, CandidateMoment } from '@chess-coach/chess-analysis';
import { buildPlannerMessages, type PlannerPromptInput } from './analysis-planner.js';

const moves: ClassifiedMove[] = [
  {
    ply: 1,
    moveSan: 'e4',
    mover: 'white',
    isUserMove: true,
    cpLoss: 0,
    quality: 'good',
    bestLineSan: ['e4', 'e5'],
    evalAfterCp: 20,
    hangsPiece: false
  },
  {
    ply: 2,
    moveSan: 'e5',
    mover: 'black',
    isUserMove: false,
    cpLoss: 0,
    quality: 'good',
    bestLineSan: ['e5'],
    evalAfterCp: 15,
    hangsPiece: false
  },
  {
    ply: 3,
    moveSan: 'h3',
    mover: 'white',
    isUserMove: true,
    cpLoss: 180,
    quality: 'mistake',
    bestLineSan: ['d4', 'exd4'],
    evalAfterCp: -160,
    hangsPiece: false
  }
];

const candidateMoments: CandidateMoment[] = [{ ply: 3, kind: 'user_mistake', cpLoss: 180 }];

function baseInput(overrides: Partial<PlannerPromptInput> = {}): PlannerPromptInput {
  return {
    band: 'club',
    focusAreas: [],
    recentFindings: [],
    selfAssessment: 'I blunder pieces',
    userColor: 'white',
    moves,
    candidateMoments,
    now: new Date('2026-07-28T12:00:00Z'),
    ...overrides
  };
}

describe('buildPlannerMessages', () => {
  test('system prompt lists all 13 categories and the moment-selection rules', () => {
    const { system } = buildPlannerMessages(baseInput());
    for (const category of MISTAKE_CATEGORIES) {
      expect(system).toContain(category);
    }
    expect(system).toContain('SELECT 4–8 moments');
  });

  test('user message includes only the student\'s (white) moves in the moves table', () => {
    const { user } = buildPlannerMessages(baseInput());
    expect(user).toContain('h3');
    expect(user).toContain('mistake');
    expect(user).toContain('180');
  });

  test('user message includes the pre-computed candidate moments', () => {
    const { user } = buildPlannerMessages(baseInput());
    expect(user).toContain('user_mistake');
    expect(user).toMatch(/ply\s*3|3.*user_mistake/i);
  });

  test('empty focus areas render the "(none yet…)" fallback', () => {
    const { user } = buildPlannerMessages(baseInput({ focusAreas: [] }));
    expect(user).toContain('none yet');
  });

  test('embeds band, self-assessment, and userColor', () => {
    const { user } = buildPlannerMessages(baseInput());
    expect(user).toContain('Club');
    expect(user).toContain('I blunder pieces');
    expect(user).toContain('white');
  });
});
