import type { RatingBand } from '@chess-coach/shared';
import { MISTAKE_CATEGORIES_BLOCK } from './render.js';

export interface ProfilerPromptInput {
  band: RatingBand;
  linkedAccounts: string[];
  rawSelfAssessment: string;
}

export interface ProfilerMessages {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = `A new student has joined a chess-coaching program. From their intake below, write:
1. A cleaned self_assessment (1–2 sentences, third person → keep their meaning, drop noise).
2. Between 0 and 2 provisional focus areas (category from the fixed list + a one-sentence note starting "Student reports..."). Only create one if the student's own words clearly point at a category; otherwise return none — real evidence comes from games.
Categories: ${MISTAKE_CATEGORIES_BLOCK}
Output JSON: { "selfAssessment": string,
               "provisionalFocusAreas": [{ "category": ..., "note": ... }] }`;

/** prompts.md §6 — one light-tier call at onboarding, seeding the profile so the
 * very first session already feels personal. */
export function buildOnboardingProfilerMessages(input: ProfilerPromptInput): ProfilerMessages {
  const linkedAccounts = input.linkedAccounts.length > 0 ? input.linkedAccounts.join(', ') : 'none linked';
  const user = `Intake: rating_band=${input.band}; linked accounts: ${linkedAccounts}; their words: "${input.rawSelfAssessment}"`;

  return { system: SYSTEM_PROMPT, user };
}
