import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiGet, ApiError } from '../../api/client.js';

/** Deliberately loose: the snapshot is the literal object that hit the LLM
 * and the literal object it returned (coach debug mode design doc, "No
 * reshaping of the captured data") — this validates the envelope, not the
 * internal message/part shapes, which vary by provider and step. */
const TurnUsageSchema = z.object({
  freshInputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number().nullable(),
  outputTokens: z.number()
});

const TurnDebugSnapshotSchema = z.object({
  request: z.object({
    provider: z.string(),
    model: z.string(),
    messages: z.array(z.unknown()),
    tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.unknown() })),
    maxSteps: z.number()
  }),
  response: z.object({
    messages: z.array(z.unknown()),
    finishReason: z.string(),
    usage: TurnUsageSchema,
    providerMetadata: z.unknown()
  })
});

export type TurnDebugSnapshot = z.infer<typeof TurnDebugSnapshotSchema>;
export type DebugMessage = { role?: unknown; content?: unknown; providerOptions?: unknown; id?: unknown };

export type TurnDebugSnapshotState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: TurnDebugSnapshot };

/** Fetches the most recent coach turn's literal LLM request/response for the
 * debug popup. DebugPanel still owns triggering this (mounted only while the
 * popup is open) — the fetch itself just lives in a hook per AGENTS.md's
 * "data fetching lives in hooks" rule. */
export function useTurnDebugSnapshot(sessionId: string): TurnDebugSnapshotState {
  const [state, setState] = useState<TurnDebugSnapshotState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    apiGet(`/api/sessions/${sessionId}/debug/last-turn`, TurnDebugSnapshotSchema)
      .then((snapshot) => {
        if (!cancelled) setState({ status: 'ready', snapshot });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof ApiError && error.status === 404
            ? 'No completed turn to debug yet.'
            : 'Could not load debug data.';
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return state;
}
