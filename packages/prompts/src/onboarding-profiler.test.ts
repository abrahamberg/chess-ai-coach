import { describe, expect, test } from 'vitest';
import { MISTAKE_CATEGORIES } from '@chess-coach/shared';
import { buildOnboardingProfilerMessages } from './onboarding-profiler.js';

describe('buildOnboardingProfilerMessages', () => {
  test('system prompt lists all 13 categories and the output JSON shape', () => {
    const { system } = buildOnboardingProfilerMessages({
      band: 'improving',
      linkedAccounts: ['lichess: annchess'],
      rawSelfAssessment: 'i always hang my queen lol'
    });

    for (const category of MISTAKE_CATEGORIES) {
      expect(system).toContain(category);
    }
    expect(system).toContain('provisionalFocusAreas');
  });

  test('user message embeds band, linked accounts, and the raw self-assessment', () => {
    const { user } = buildOnboardingProfilerMessages({
      band: 'improving',
      linkedAccounts: ['lichess: annchess', 'chesscom: ann_c'],
      rawSelfAssessment: 'i always hang my queen lol'
    });

    expect(user).toContain('improving');
    expect(user).toContain('lichess: annchess');
    expect(user).toContain('chesscom: ann_c');
    expect(user).toContain('i always hang my queen lol');
  });

  test('renders "none linked" when there are no linked accounts', () => {
    const { user } = buildOnboardingProfilerMessages({
      band: 'novice',
      linkedAccounts: [],
      rawSelfAssessment: 'new to chess'
    });

    expect(user).toContain('none linked');
  });
});
