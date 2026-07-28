import { generateText, streamText } from 'ai';
import { CoachingPlanSchema, SessionOutcomeSchema } from '@chess-coach/shared';
import { describe, expect, test } from 'vitest';
import { buildFakeModel } from './fake.js';

describe('buildFakeModel', () => {
  test('streams a canned reply without hitting any real provider', async () => {
    const model = buildFakeModel();

    const result = streamText({ model, prompt: 'hello' });
    let text = '';
    for await (const delta of result.textStream) text += delta;

    expect(text.length).toBeGreaterThan(0);
  });

  test('also supports non-streaming generateText (used by the planner/summarizer light calls)', async () => {
    const model = buildFakeModel();

    const result = await generateText({ model, prompt: 'hello' });

    expect(result.text.length).toBeGreaterThan(0);
  });

  test('returns a valid CoachingPlan JSON when the prompt is the analysis planner\'s', async () => {
    const model = buildFakeModel();

    const result = await generateText({
      model,
      system: 'Produce a lesson plan as JSON matching the provided schema. Output shape includes gameSummary, openingNote...',
      prompt: 'Here is the game.'
    });

    expect(CoachingPlanSchema.safeParse(JSON.parse(result.text)).success).toBe(true);
  });

  test('returns a valid SessionOutcome JSON when the prompt is the session summarizer\'s', async () => {
    const model = buildFakeModel();

    const result = await generateText({
      model,
      system: 'Extract durable facts into JSON matching the schema, including sessionSummary for the dashboard.',
      prompt: 'Here is the transcript.'
    });

    expect(SessionOutcomeSchema.safeParse(JSON.parse(result.text)).success).toBe(true);
  });

  test('returns plain prose for an ordinary chat prompt (neither planner nor summarizer)', async () => {
    const model = buildFakeModel();

    const result = await generateText({ model, system: 'You are a chess coach.', prompt: 'hi coach' });

    expect(() => JSON.parse(result.text)).toThrow();
  });
});
