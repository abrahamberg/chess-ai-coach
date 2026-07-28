import { describe, expect, test } from 'vitest';
import { MISTAKE_CATEGORIES } from '@chess-coach/shared';
import {
  MISTAKE_CATEGORIES_BLOCK,
  relativeDate,
  renderCoachingPlanBlock,
  renderFocusAreasBlock,
  renderRecentFindingsBlock
} from './render.js';

describe('MISTAKE_CATEGORIES_BLOCK', () => {
  test('contains all 13 categories, comma-separated', () => {
    for (const category of MISTAKE_CATEGORIES) {
      expect(MISTAKE_CATEGORIES_BLOCK).toContain(category);
    }
    expect(MISTAKE_CATEGORIES_BLOCK).toBe(MISTAKE_CATEGORIES.join(', '));
  });
});

describe('relativeDate', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  test('today', () => {
    expect(relativeDate(new Date('2026-07-28T01:00:00Z'), now)).toBe('today');
  });
  test('yesterday', () => {
    expect(relativeDate(new Date('2026-07-27T01:00:00Z'), now)).toBe('yesterday');
  });
  test('N days ago', () => {
    expect(relativeDate(new Date('2026-07-23T01:00:00Z'), now)).toBe('5 days ago');
  });
  test('N weeks ago', () => {
    expect(relativeDate(new Date('2026-07-10T01:00:00Z'), now)).toBe('2 weeks ago');
  });
  test('N months ago', () => {
    expect(relativeDate(new Date('2026-04-28T01:00:00Z'), now)).toBe('3 months ago');
  });
});

describe('renderFocusAreasBlock', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  test('renders the "(none yet…)" fallback for an empty list', () => {
    expect(renderFocusAreasBlock([], now)).toBe(
      '(none yet — this is early in your work together)'
    );
  });

  test('renders one line per focus area with status, category, note, evidence count, and relative date', () => {
    const block = renderFocusAreasBlock(
      [
        {
          category: 'king_safety',
          status: 'active',
          note: 'stops calculating after first capture',
          evidenceCount: 3,
          lastSeenAt: new Date('2026-07-27T01:00:00Z')
        }
      ],
      now
    );
    expect(block).toBe(
      '- [active] king_safety: stops calculating after first capture (seen 3x, last yesterday)'
    );
  });
});

describe('renderRecentFindingsBlock', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  test('renders a fallback for an empty list', () => {
    expect(renderRecentFindingsBlock([], now)).toContain('none yet');
  });

  test('renders one line per finding with +/- marker, category, description, relative date', () => {
    const block = renderRecentFindingsBlock(
      [
        {
          category: 'hanging_piece',
          description: 'Hung a knight on move 14 without checking captures.',
          isPositive: false,
          createdAt: new Date('2026-07-28T01:00:00Z')
        },
        {
          category: 'king_safety',
          description: 'Castled on time this game — first time in three sessions.',
          isPositive: true,
          createdAt: new Date('2026-07-21T01:00:00Z')
        }
      ],
      now
    );
    expect(block).toBe(
      '- [-] hanging_piece: Hung a knight on move 14 without checking captures. (today)\n' +
        '- [+] king_safety: Castled on time this game — first time in three sessions. (1 weeks ago)'
    );
  });
});

describe('renderCoachingPlanBlock', () => {
  test('numbers each moment with ply, kind, question, and key line', () => {
    const block = renderCoachingPlanBlock({
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
          socraticQuestion: 'Before pushing this pawn, where is your king going to live?',
          keyLine: 'O-O Re8 d3 h6',
          revealDepthPlies: 6
        }
      ]
    });

    expect(block).toBe(
      '1. Ply 23 (user_mistake): "Before pushing this pawn, where is your king going to live?" Key line: O-O Re8 d3 h6'
    );
  });
});
