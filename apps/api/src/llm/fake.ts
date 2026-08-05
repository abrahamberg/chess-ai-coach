import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import type { LanguageModelV4CallOptions, LanguageModelV4Usage } from '@ai-sdk/provider';

const FAKE_CHAT_REPLY =
  "This is a canned LLM_FAKE reply — local dev/smoke-test mode, no real model was called. " +
  "I'm the coach, and I can see the board. What would you like to work on?";

// Matches CoachingPlanSchema (packages/shared/src/coaching-plan.ts) — the
// analysis planner asks the model for exactly this shape.
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

// Matches SessionOutcomeSchema (packages/shared/src/session.ts).
const FAKE_SESSION_OUTCOME = JSON.stringify({
  sessionSummary: 'LLM_FAKE canned summary — no real session review was performed.',
  homework: null,
  findings: [],
  focusAreaUpdates: []
});

const FAKE_USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined }
};

const FAKE_FINISH = { unified: 'stop', raw: undefined } as const;

/** Task 7.2: `LLM_FAKE=1` local-dev mode — a canned mock-model response, so
 * `scripts/smoke.sh` can exercise the full import→session flow without real
 * Anthropic/OpenAI keys. Wired in via GatewayConfig.fake (llm/gateway.ts) and
 * bootstrap.ts's light model, never on unless that flag is explicitly set.
 *
 * The gateway is used by several call sites expecting different shapes from
 * the same "light-tier" call — the analysis planner and session summarizer
 * each want a different JSON schema, while the coach chat and episode-fold
 * digests want plain prose. There's no clean signal to distinguish them other
 * than the request itself, so this sniffs it for each schema's own
 * distinctive required field name. Schema-constrained calls carry that name
 * in `responseFormat` rather than in the prompt text, so both are searched. */
export function buildFakeModel(): LanguageModel {
  return new MockLanguageModelV4({
    doStream: (options) =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'fake-1' });
            controller.enqueue({ type: 'text-delta', id: 'fake-1', delta: fakeReplyFor(options) });
            controller.enqueue({ type: 'text-end', id: 'fake-1' });
            controller.enqueue({ type: 'finish', finishReason: FAKE_FINISH, usage: FAKE_USAGE });
            controller.close();
          }
        })
      }),
    doGenerate: (options) =>
      Promise.resolve({
        content: [{ type: 'text', text: fakeReplyFor(options) }],
        finishReason: FAKE_FINISH,
        usage: FAKE_USAGE,
        warnings: []
      })
  });
}

function fakeReplyFor(options: LanguageModelV4CallOptions): string {
  const request = JSON.stringify([options.prompt, options.responseFormat]);
  if (request.includes('gameSummary')) return FAKE_COACHING_PLAN;
  if (request.includes('sessionSummary')) return FAKE_SESSION_OUTCOME;
  return FAKE_CHAT_REPLY;
}
