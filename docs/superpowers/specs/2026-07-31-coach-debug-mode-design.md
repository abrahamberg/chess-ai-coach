# Coach debug mode — design

Status: approved, ready for implementation planning.

## Problem

The coach agent's system prompt is documented (`docs/architecture.md` §8.1) to use
Anthropic prompt caching, but it's never actually been wired up: `coach-agent.ts`
sends the system prompt as a single concatenated string with no `cache_control`
breakpoints, and `cachedInputTokens` is hardcoded to `0` in `onFinish`. There's also
no way to inspect what was actually sent to the model for a given turn — no raw
prompt, no tool-call/result detail beyond the replayed transcript, no real token
breakdown.

This feature adds a small "debug last answer" button to the coach chatbox that pops
up a readable, color-coded view of exactly what was sent to the LLM and exactly what
came back for the most recent turn, including real cache/token numbers. Getting real
numbers requires actually implementing the caching that was only ever documented.

## Scope decisions (from brainstorming)

- **Caching is being implemented for real**, not just displayed as fake/zero. This is
  the actual point of the feature — a debug panel showing cache stats that are always
  0 would be worse than not building it.
- **Both Anthropic and OpenAI must work.** The two providers report cache usage in
  incompatible shapes (see "Provider-specific usage" below) and must be normalized to
  one consistent display.
- **Visible to all users, in every environment** (not dev-only, not role-gated).
- **Latest turn only.** One button, always pointing at the most recent coach reply.
  No per-message historical debug buttons, no persistence of prompt/usage detail per
  message — a single, overwritten-every-turn snapshot per session is sufficient. It's
  stored on the session row (not in-process memory) so it's consistent across k8s pods
  and process restarts — see "Debug snapshot: capture, storage, delivery" below.
- **Billing/credit math is out of scope.** Real cache-read tokens flow into the
  existing `llm_call_log.cachedInputTokens` column (matches its documented meaning:
  discounted re-used tokens). Cache-write tokens (Anthropic's ~1.25x premium for
  populating the cache) are surfaced in the debug view only — they are **not** added
  to `computeCredits`. Fixing credit metering for cache-write cost is a separate,
  future billing-correctness task.
- **No reshaping of the captured data.** The debug snapshot is the literal object
  passed to `streamText` (request) and the literal object the SDK returns (response),
  not a redesigned/relabeled abstraction. The UI renders that literal data nicely;
  it doesn't invent a new taxonomy on top of it.

## Backend: wiring up real caching

`coach-agent.ts:198-200` currently does:

```ts
system: `${staticPart}\n\n${dynamicPart}`,
messages,
```

This becomes two `CoreSystemMessage` entries prepended to `messages`, each with its
own Anthropic cache breakpoint, matching the design already committed in
`docs/architecture.md` §8.1 (static block, then dynamic block, then conversation —
conversation itself stays uncached since it's not a stable prefix):

```ts
messages: [
  { role: 'system', content: staticPart,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
  { role: 'system', content: dynamicPart,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
  ...priorMessages.map(toCoreMessage)
]
```

Verified against the installed SDK (`ai@4.3.19`, `@ai-sdk/anthropic@1.2.12`): the
Anthropic provider (`@ai-sdk/anthropic/dist/index.js` ~line 191-208) merges
consecutive `role: 'system'` messages not separated by a user/assistant turn into
Anthropic's `system` content-block array, each block keeping its own
`providerOptions`-derived `cache_control`. Two leading system messages therefore
become two independently cacheable blocks, exactly as needed. `providerOptions` is a
no-op for OpenAI (harmless), which caches automatically based on prefix stability —
the same static/dynamic/conversation ordering already gets OpenAI's discount for
free, no extra config needed.

### Provider-specific usage

The two providers expose cache stats differently:

- **Anthropic**: `input_tokens` (fresh only, excludes cache), `cache_read_input_tokens`,
  `cache_creation_input_tokens`, `output_tokens` — four independent real numbers,
  available via `providerMetadata.anthropic.{cacheCreationInputTokens,cacheReadInputTokens}`
  (confirmed at `@ai-sdk/anthropic/dist/index.js:702-703,843-844`) plus
  `event.usage.promptTokens` (confirmed == raw `input_tokens`, i.e. already
  fresh-only, at line 687) and `event.usage.completionTokens`.
- **OpenAI**: `prompt_tokens` (**includes** cached tokens), `cached_tokens` (subset of
  prompt_tokens), `completion_tokens`. No separate cache-write cost exists — OpenAI's
  prefix caching is automatic and free to populate. Available via
  `providerMetadata.openai.cachedPromptTokens` (confirmed at
  `@ai-sdk/openai/dist/index.js:660-661,814-815,2347,2453`).

Normalized shape used everywhere downstream (backend record, API response, UI):

```ts
interface TurnUsage {
  freshInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number | null; // null = "not applicable" (OpenAI), never coerced to 0
  outputTokens: number;
}
```

Computed per provider in `onFinish`:

- **Anthropic**: `freshInputTokens = usage.promptTokens`,
  `cacheReadTokens = providerMetadata.anthropic.cacheReadInputTokens ?? 0`,
  `cacheWriteTokens = providerMetadata.anthropic.cacheCreationInputTokens ?? 0`,
  `outputTokens = usage.completionTokens`.
- **OpenAI**: `cacheReadTokens = providerMetadata.openai.cachedPromptTokens ?? 0`,
  `freshInputTokens = usage.promptTokens - cacheReadTokens`, `cacheWriteTokens = null`,
  `outputTokens = usage.completionTokens`.

`recordUsage`'s existing `cachedInputTokens` argument (→ `llm_call_log`) receives
`cacheReadTokens`. `cacheWriteTokens` is not persisted to `llm_call_log`; it only
flows into the debug snapshot below.

## Debug snapshot: capture, storage, delivery

In `onFinish`, alongside the existing persistence, build and store:

```ts
interface TurnDebugSnapshot {
  request: {
    provider: 'anthropic' | 'openai';
    model: string;              // resolution.modelId
    messages: CoreMessage[];    // exactly what was passed to streamText: the two
                                 // system messages (with real providerOptions) +
                                 // the full prior conversation, verbatim
    tools: Array<{ name: string; description: string; parameters: unknown }>; // schema
                                 // only, serialized from buildCoachTools — not the
                                 // JS closures
    maxSteps: number;
  };
  response: {
    messages: CoreMessage[];    // exactly event.response.messages — this turn's new
                                 // content: text, tool-call, tool-result, and
                                 // reasoning/redacted-reasoning parts if present
    finishReason: string;       // event.finishReason
    usage: TurnUsage;
    providerMetadata: unknown;  // event.providerMetadata, unmodified
  };
}
```

Storage: a nullable `debug_snapshot jsonb` column directly on the `sessions` row
(migration `0005_session_debug_snapshot.ts`), overwritten every turn via
`sessionsRepo.updateDebugSnapshot`/`getDebugSnapshot` — the exact same
latest-state-on-the-row pattern the `threads` column already uses for the backstage
conversation ledger (architecture §7.1). Written first in `onFinish`, before message
persistence/`recordUsage`, so a failure further down never hides it. This was
originally designed as an in-memory `Map<sessionId, TurnDebugSnapshot>` (matching the
engine-result LRU's precedent, architecture §8.3) but that breaks the instant the API
runs as more than one k8s pod: pods share nothing, so a debug request can land on a
different pod than the one that produced the turn and 404 even though a turn
genuinely completed. The DB-backed version is consistent across pods and process
restarts, at the cost of one small JSON write per turn (comparable to the existing
per-turn message-persistence writes in the same `onFinish`).

Delivery: new endpoint `GET /api/sessions/:id/debug/last-turn` in
`apps/api/src/routes/sessions.ts`, returning the snapshot as JSON (404 if no turn has
completed yet for this session, or session not found / not owned by the requesting
user — same auth check pattern as the other session routes). The frontend fetches
this **lazily when the debug button is clicked**, not bundled into the normal chat
data stream — keeps every other user's regular chat payload small since most people
will never open it.

## Frontend

### Trigger

A small icon button in `ChatPane`'s header area (`apps/web/src/features/chat/ChatPane.tsx`),
tooltip "Debug last answer". Disabled/hidden until at least one assistant turn has
completed in the session (i.e. once `messages` contains an assistant entry — mirrors
how `activeToolName`/`isThinking` already track turn state in `useCoachChat.ts`).
Click → `fetch('/api/sessions/:id/debug/last-turn')` → open modal. Loading and error
states (e.g. a 404 before any turn) render inline in the modal rather than failing
silently.

### Modal — "console" layout

New component, e.g. `apps/web/src/features/chat/DebugPanel.tsx` + `DebugPanel.css`,
following this project's plain-CSS-per-component pattern (no component library).
Centered modal, max-width ~900px, max-height ~90vh, internal scroll, closes on `Esc`
or backdrop click.

**Header bar**: provider + model name + short session id, a **Copy JSON** button
(`navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))`, brief "Copied"
confirmation), close button.

**Usage strip**: four color-coded stat tiles reading straight from
`response.usage`: **Fresh input** / **Cache read** / **Cache write** (renders "n/a"
with a muted style + tooltip when `null`, explaining OpenAI's automatic caching — never
silently shown as `0`) / **Output**.

**Two-column body**, mirroring a network-inspector/REPL vernacular:

- **Left column, "Sent to model"** (`request.messages`): one card per message,
  color-coded left border by role (system / user / assistant / tool). Cards are
  **collapsed by default to a one-line preview** (role pill + content preview),
  except the last few messages (this turn's immediate lead-up), which render
  expanded. Click any row to toggle. A **cache badge** appears on any message whose
  own `providerOptions.anthropic.cacheControl` is present — read directly off that
  message object, never inferred or recomputed. `request.tools` renders as a compact
  collapsible list below the messages (name + description + params schema).
- **Right column, "Received this turn"** (`response.messages`): same card language,
  tagged "new". Final assistant text renders prominently as plain readable
  paragraphs; `reasoning`/`redacted-reasoning` content parts (if the model produced
  any) render in a visually distinct dashed/italic block labeled "reasoning";
  tool-call/tool-result parts render as labeled code blocks. `finishReason` shown as
  a small footer tag under this column.

Visual design (validated via mockup, see below): monospace-forward typography
throughout (`ui-monospace` stack) since the content is inherently code/data, with a
tracked system-sans reserved for headers and labels only. Neutral palette is a cool
slate (not pure grey), with a single gold/amber accent reserved for the cache
badge/copy button (piece-gold, ties to the chess subject without being cute about
it). Message roles get their own separate semantic colors (violet=system,
blue=user, teal=assistant, orange=tool) distinct from the accent. Usage tiles get
their own separate semantic set (neutral/green/amber/blue for
fresh/read/write/output). Both light and dark themes defined via CSS custom
properties, `prefers-color-scheme` + `data-theme` override per the artifact-design
pattern.

A static mockup was built and approved during brainstorming:
`/tmp/claude-1000/-home-daniel-Projects-chess-ai-coach/8f811d22-c02d-4633-8e59-7e60c020cc6f/scratchpad/debug-popup-mockup.html`
(published as a Claude artifact for review). Treat it as the visual reference for
implementation, not a component to copy verbatim — it's plain static HTML/CSS, not
React.

## Key files touched

- `apps/api/src/services/coach-agent.ts` — `startTurn` (system→messages restructure,
  cache breakpoints), `onFinish` (provider-aware usage normalization, debug snapshot
  capture/storage).
- `apps/api/src/llm/gateway.ts` — no change to `recordUsage`'s contract; callers now
  pass real `cachedInputTokens` instead of `0`.
- `apps/api/src/db/migrations/0005_session_debug_snapshot.ts` (new) — nullable
  `debug_snapshot jsonb` column on `sessions`; registered in `db/migrate.ts`.
- `apps/api/src/db/schema.ts` — `SessionsTable.debugSnapshot`.
- `apps/api/src/db/repositories/sessions.ts` — `updateDebugSnapshot`/`getDebugSnapshot`,
  mirroring the existing `updateThreads`/`getThreads` pattern.
- `apps/api/src/routes/sessions.ts` — new `GET /api/sessions/:id/debug/last-turn`.
- `apps/web/src/features/chat/ChatPane.tsx` — new debug trigger button.
- `apps/web/src/features/chat/DebugPanel.tsx` (new), `DebugPanel.css` (new).
- `apps/web/src/hooks/useCoachChat.ts` — expose whether an assistant turn has
  completed (to gate the trigger button), if not already derivable from `messages`.

## Testing

- Unit: provider-usage normalization function (Anthropic vs OpenAI branches,
  including the OpenAI `freshInputTokens = promptTokens - cachedPromptTokens`
  subtraction and the `cacheWriteTokens: null` case).
- Unit: cache breakpoint construction (the two leading system messages carry the
  expected `providerOptions.anthropic.cacheControl`).
- Integration: `GET /api/sessions/:id/debug/last-turn` — 404 before any turn, correct
  snapshot shape after one, auth/ownership check, and a snapshot written by one
  `buildApp` instance is readable from a second independent instance sharing only the
  database (proves it survives a process restart / a different k8s pod than the one
  that produced it — the reason this isn't an in-memory Map).
- Frontend: `DebugPanel` renders a fixture snapshot correctly (role colors, cache
  badges, collapsed/expanded default state, copy-to-clipboard).
- Live-browser check (per this project's standing practice): run a real session,
  send a couple of turns, open the debug panel, confirm real non-zero cache-read
  numbers appear on turn 2+ for an Anthropic session.
