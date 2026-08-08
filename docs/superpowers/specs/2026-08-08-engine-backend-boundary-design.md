# Pluggable engine backend boundary (native + browser WASM tunnel)

Date: 2026-08-08 · Status: Approved for implementation

## Context

Today, `apps/api` calls the chess engine exclusively through `services/engine`
(a Stockfish HTTP microservice) via two plain functions in
`apps/api/src/services/engine-client.ts`. Every consumer of engine analysis
(coach tools, move classification, the game-import pipeline, the on-demand
position route) already depends on the result only through
structurally-typed function fields injected via DI
(`analyzePosition: (fen) => Promise<PositionAnalysis>`,
`analyzeGamePositions: (fens) => Promise<EngineEval[]>`) — but those fields
are wired to one hardcoded implementation, once, at bootstrap.

The goal of this change is to turn that implicit seam into a real boundary:
`apps/api` should have no idea where the engine physically runs. The first
new backend behind that boundary is a browser-side WASM Stockfish, reached by
tunneling analysis requests to the user's own connected browser tab over a
WebSocket — reusing the WASM engine that already exists for the
exploration-only "Explore panel" (`apps/web/src/hooks/useWasmEngine.ts`)
rather than running a second engine process client-side. Users choose
`native` or `browser` via a new setting; native stays the default and is
always available. The browser backend is not "advisory" — for a user who
opts in, its results are fully authoritative (persisted, used by the coach,
identical schemas to native) since it's their own compute producing their
own coaching data. This is an explicit, scoped amendment to the current
`docs/architecture.md` invariant ("only server-side Stockfish evaluations
are trusted") — that invariant becomes the *default*, not an absolute.

This spec is boundary-first: the interface and resolution mechanism are the
point; the WASM/WebSocket pieces are the first proof that the boundary
generalizes to a backend that isn't an HTTP microservice.

## Non-goals

- No changes to `services/engine` itself.
- No horizontal-scaling solution for the tunnel connection registry (see
  Known limitations).
- No new UI for surfacing `isExternalEval` provenance to users — it's an
  internal cache-quality signal only, never coach-facing (per the existing
  rule that raw engine data is never shown in coach UI copy).
- Not scoped here: the actual step-by-step implementation task breakdown —
  that's the output of the `writing-plans` skill, run against this spec.

## Architecture

### 1. The boundary: `EngineBackend` port

A new `apps/api/src/services/engine/` directory owns the entire engine
backend surface, mirroring how `apps/api/src/llm/` already owns the LLM
provider surface (`AGENTS.md` rule 6 — nothing outside `llm/` imports `ai` or
`@ai-sdk/*`). The equivalent rule here: nothing outside `services/engine/`
constructs or imports a concrete backend.

```ts
// apps/api/src/services/engine/engine-backend.ts
interface EngineBackend {
  analyzePosition(fen: string, opts?: { depth?: number; multiPv?: number }): Promise<PositionAnalysis>;
  analyzeGame(fens: string[], opts?: { depth?: number; multiPv?: number }): Promise<EngineEval[]>;
}
```

Request/response types reuse the existing `packages/shared/src/analysis.ts`
schemas (`PositionAnalysis`, `EngineEval`) unchanged — both backends speak
the same contract.

### 2. Two implementations

- **`NativeEngineBackend`** (`native-engine-backend.ts`) — thin wrapper
  around the existing `analyzePositionViaEngine`/`analyzeGameViaEngine` HTTP
  calls in `engine-client.ts`. Behavior-identical to today; this is a
  low-risk rename/formalize, not a rewrite.
- **`BrowserTunnelEngineBackend`** (`browser-tunnel-engine-backend.ts`) —
  looks up the caller's live WebSocket connection in the tunnel registry,
  sends a correlated request (`requestId`), awaits the correlated response.
  Two failure modes, both fail fast with no fallback (per explicit decision
  below): no connection found → throw immediately; connection found but no
  response within a request-level timeout → throw immediately. Timeout is
  env-configurable (`ENGINE_TUNNEL_TIMEOUT_MS`), same pattern as native's
  existing `ENGINE_MOVE_TIMEOUT_MS`.

  Both backends must analyze at the same default `depth`/`multiPv` when the
  caller doesn't override them — this is not new (native already fixes
  `multiPv` via a shared constant today specifically so cached rows stay
  comparable across callers) but it now matters across sources too: a
  browser-computed row and a native-computed row for the same FEN must be
  directly comparable, or `isExternalEval`'s "native heals the cache"
  guarantee (§7) doesn't hold. `BrowserTunnelEngineBackend` reuses the same
  default constants `NativeEngineBackend` does rather than letting the
  browser choose its own depth.

### 3. Per-user resolution replaces bootstrap-time wiring

`resolve-engine-backend.ts` exports `resolveEngineBackend(userId)`:
reads that user's `engineMode` setting (`'native' | 'browser'`, new field —
see Settings below), returns `NativeEngineBackend` for `'native'`, or looks
up an active tunnel connection for `'browser'` and returns a
`BrowserTunnelEngineBackend` bound to it. No connection → throws
`EngineUnavailableError` (new typed error in `apps/api/src/lib/errors.ts`,
mapped to problem+json by the existing error-mapper plugin).

This is a real behavior change from today: `bootstrap.ts`,
`jobs/analyze-game.ts`, and `jobs/deepen-analysis.ts` currently wire
`analyzePosition`/`analyzeGamePositions` once, globally, at process start.
Going forward these must be resolved per-operation against the specific user
whose data is being processed — background jobs already know which
user/game they're processing, so this is a threading change, not a new
capability.

**Decision: fail fast, no fallback.** If `browser` mode is selected and no
tunnel is available, the operation fails rather than silently degrading to
native compute. For background jobs (game-import, deepen-analysis), that
failure is just a job failure — `graphile-worker`'s existing retry/backoff
naturally retries later once the user's tab reconnects. No bespoke queue.

### 4. Transport: WebSocket tunnel

New `@fastify/websocket` endpoint (e.g. `/api/engine-tunnel`), authenticated
identically to other routes. `engine-tunnel-registry.ts` holds an in-memory
`Map<userId, connection>` (last-connected-tab wins on multiple tabs — not
solved further here). Messages carry a `requestId` for correlation; one
connection can multiplex multiple in-flight requests (needed since
`analyzeGame` sends a batch).

### 5. Browser side: one shared WASM worker, two consumers

`apps/web/src/hooks/useWasmEngine.ts` splits into:
- A low-level shared worker client (owns the single `Worker` instance + UCI
  handshake/plumbing) — extracted from the current hook's internals.
- The existing Explore panel wrapper (word-only evals, unchanged UX,
  unchanged "never sent to server" behavior) now sits on top of the shared
  client instead of owning its own worker.
- A new `useEngineTunnelClient.ts`: when `engineMode === 'browser'` and the
  WS is open, receives tunnel requests, runs them through the *same* shared
  worker, returns full structured `PositionAnalysis`/`EngineEval` (not
  word-only) over the socket.

This guarantees only one engine process ever runs in the browser at a time,
regardless of whether Explore and tunnel-fulfillment are both active.

### 6. `CachingEngineBackend` — unified caching for both operations

A decorator implementing `EngineBackend` by wrapping whichever raw backend
was resolved:

```ts
resolveEngineBackend(userId) // returns:
new CachingEngineBackend(rawBackend, { isExternalSource: mode === 'browser' })
```

- `analyzePosition(fen)`: check `position_evaluations` first; on miss,
  delegate to the wrapped backend and write the result back. This replaces
  today's `position-analysis-cache.ts`/`getOrComputePositionAnalysis`, which
  did this inline for the single-position path only.
- `analyzeGame(fens)`: **new** — check the cache for every FEN first; only
  FENs that miss get sent to the wrapped backend as one batched call
  (preserving today's "sequential per-position, one round trip" contract);
  results merge back in original order; misses get written to cache.
  Concretely: importing a game with common opening theory only tunnels the
  genuinely novel positions to a browser-mode user's tab — most of a typical
  game comes straight from cache, reducing how long the tab needs to stay
  connected.

### 7. `isExternalEval` — cache correctness across trust levels

New boolean column on `position_evaluations`: `is_external_eval`.

- **Write:** browser-tunnel results are persisted with `is_external_eval =
  true`. Native results are always persisted with `is_external_eval =
  false`, and a native write always overwrites an existing row regardless of
  its prior flag — this is what "heals" the cache back to native quality.
- **Read, native-mode caller:** a row only counts as a hit if
  `is_external_eval = false`; an externally-flagged-only row is a miss,
  forcing a fresh native compute (which then heals that row).
- **Read, browser-mode caller:** any row is a hit, native or external —
  native is equal-or-better quality, so no reason to exclude it.

This keeps the existing multi-user-shared cache correct: native-mode users
can never be silently served another user's browser-computed result as if
it were authoritative, while browser-mode users still benefit immediately
from anything already computed natively.

### 8. Cache bound (currently nonexistent — pre-existing gap, made more urgent here)

Confirmed via `apps/api/src/db/migrations/0008_position_evaluations.ts`:
`fen text PRIMARY KEY`, no TTL, no row cap, no cleanup job — unbounded since
introduction. This design increases write volume (batch caching + external
writes), so it adds:

- New column: `last_accessed_at timestamptz NOT NULL DEFAULT now()`, touched
  on every cache-hit read (single indexed update by PK `fen` — cheap next to
  the ~1s+ Stockfish analysis it's replacing).
- Env-configurable row cap (`POSITION_EVAL_CACHE_MAX_ROWS`) and a minimum-age
  floor (`POSITION_EVAL_CACHE_MIN_AGE_DAYS`).
- A daily `graphile-worker` job: if over cap, delete rows ordered by
  `last_accessed_at ASC`, but only from rows where `created_at < now() -
  MIN_AGE_DAYS`. Rows younger than the floor are never eviction candidates —
  protects positions a game-import or `deepen-analysis` pass just wrote and
  may re-read shortly after.

### 9. Settings

New `engineMode: 'native' | 'browser'` field on `UserProfileSchema` /
`UpdateUserProfileRequestSchema` (`packages/shared/src/user.ts`) plus a
migration adding the column. New section on `SettingsPage.tsx`, following
the existing `BandSelect` pattern.

## Known limitations (explicitly deferred, not solved here)

- **Tunnel registry is per-API-process.** If `apps/api` ever scales past one
  replica, a request can land on a pod that isn't holding that user's
  socket. Fine at the target scale (500–2000 users); if it matters later,
  Postgres `LISTEN/NOTIFY` is the natural upgrade path since it's already in
  the stack via `graphile-worker`.
- **One tunnel connection per user.** Multiple open tabs: last-connected
  wins; older tabs' in-flight responses are simply orphaned.
- **`analyzeGame` tunnel calls are not chunked.** A large novel-position
  batch (e.g. a long game with little cached theory) ties up the user's
  browser worker for the whole batch, serially, same as native's existing
  "sequential per-position" behavior — not made worse, but not improved
  either.

## Critical files

- New: `apps/api/src/services/engine/{engine-backend,native-engine-backend,
  browser-tunnel-engine-backend,caching-engine-backend,
  engine-tunnel-registry,resolve-engine-backend}.ts`
- New: `apps/api/src/routes/engine-tunnel.ts` (WS route registration)
- Modify: `apps/api/src/lib/errors.ts` (add `EngineUnavailableError`)
- Modify: `apps/api/src/bootstrap.ts`, `apps/api/src/jobs/analyze-game.ts`,
  `apps/api/src/jobs/deepen-analysis.ts` (switch from bootstrap-time wiring
  to per-user `resolveEngineBackend`)
- Remove/fold in: `apps/api/src/services/position-analysis-cache.ts` (logic
  moves into `caching-engine-backend.ts`)
- New migrations: add `is_external_eval`, `last_accessed_at` to
  `position_evaluations`; add `engine_mode` to the user profile table; a
  scheduled `graphile-worker` prune task.
- Modify: `packages/shared/src/user.ts` (schema fields)
- Modify: `apps/web/src/hooks/useWasmEngine.ts` → split into shared worker
  client + Explore wrapper; new `apps/web/src/hooks/useEngineTunnelClient.ts`
- New: `apps/web/src/features/settings/EngineModeSelect.tsx`

## Testing approach

- `CachingEngineBackend`: unit tests with an injectable fake `EngineBackend`
  and a real (Testcontainers) Postgres — assert hit/miss/write/heal
  behavior for both `analyzePosition` and `analyzeGame`, including the
  `isExternalEval` read/write asymmetry between native and browser callers.
- `BrowserTunnelEngineBackend` / registry: unit tests with a fake WebSocket
  connection — assert request/response correlation, timeout-without-fallback,
  and no-connection-throws-immediately.
- `resolveEngineBackend`: unit tests over both settings values.
- Cache prune job: Testcontainers-backed test seeding rows at various ages/
  access times, asserting the age floor is respected and eviction order is
  LRU-among-eligible.
- Browser hooks: existing `useWasmEngine.test.ts`/`ExplorePanel.test.tsx`
  patterns (injectable `createWorker`) extended to cover the shared-worker
  split and the new tunnel-fulfillment hook.
- End-to-end verification once implemented: run the full local stack
  (`npm run dev`), switch a test user to `browser` mode in Settings, drive a
  live coach session and a game import through the browser, and confirm (a)
  results are persisted and used identically to native, (b) closing the tab
  produces a fail-fast error rather than a silent native fallback, (c)
  reopening the tab lets a retried background job succeed.
