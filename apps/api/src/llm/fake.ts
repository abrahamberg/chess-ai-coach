import { MockLanguageModelV1 } from 'ai/test';
import type { LanguageModel, LanguageModelV1CallOptions } from 'ai';

const FAKE_CHAT_REPLY =
  "This is a canned LLM_FAKE reply — local dev/smoke-test mode, no real model was called. " +
  "I'm the coach, and I can see the board. What would you like to work on?";

// Matches CoachingPlanSchema (packages/shared/src/coaching-plan.ts) — the
// analysis planner (packages/prompts/src/analysis-planner.ts) JSON.parses
// and validates the model's text against this shape.
const FAKE_COACHING_PLAN = JSON.stringify({
  gameSummary: 'LLM_FAKE canned plan — no real analysis was performed.',
  openingNote: 'LLM_FAKE canned note.',
  themes: ['calculation_error'],
  connectionToHistory: 'LLM_FAKE canned connection.',
  moments: [
    {
      ply: 1,
      kind: 'instructive',
      category: 'calculation_error',
      whatHappened: 'LLM_FAKE canned moment — no real analysis was performed.',
      socraticQuestion: 'What would you play here?',
      keyLine: 'e4 e5',
      revealDepthPlies: 2
    }
  ]
});

// Matches SessionOutcomeSchema (packages/shared/src/session.ts) — the
// session summarizer (packages/prompts/src/progress-summarizer.ts) JSON.parses
// and validates the model's text against this shape.
const FAKE_SESSION_OUTCOME = JSON.stringify({
  sessionSummary: 'LLM_FAKE canned summary — no real session review was performed.',
  homework: null,
  findings: [],
  focusAreaUpdates: []
});

/** Task 7.2: `LLM_FAKE=1` local-dev mode — a MockLanguageModelV1 canned
 * response, so `scripts/smoke.sh` can exercise the full import→session flow
 * without real Anthropic/OpenAI keys. Wired in via GatewayConfig.fake
 * (llm/gateway.ts) and bootstrap.ts's callLightModel, never on unless that
 * flag is explicitly set.
 *
 * The gateway is used by several call sites expecting different shapes from
 * the same "light-tier" call — the analysis planner and session summarizer
 * both JSON.parse the response against different schemas, while the coach
 * chat and episode-fold digests want plain prose. There's no clean signal to
 * distinguish them other than the prompt text itself, so this sniffs the
 * prompt for each schema's own distinctive required field name. */
export function buildFakeModel(): LanguageModel {
  return new MockLanguageModelV1({
    doStream: (options) =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-delta', textDelta: fakeReplyFor(options) });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { promptTokens: 1, completionTokens: 1 }
            });
            controller.close();
          }
        }),
        rawCall: { rawPrompt: null, rawSettings: {} }
      }),
    doGenerate: (options) =>
      Promise.resolve({
        text: fakeReplyFor(options),
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1 },
        rawCall: { rawPrompt: null, rawSettings: {} }
      })
  });
}

function fakeReplyFor(options: LanguageModelV1CallOptions): string {
  const promptText = JSON.stringify(options.prompt ?? '');
  if (promptText.includes('gameSummary')) return FAKE_COACHING_PLAN;
  if (promptText.includes('sessionSummary')) return FAKE_SESSION_OUTCOME;
  return FAKE_CHAT_REPLY;
}
