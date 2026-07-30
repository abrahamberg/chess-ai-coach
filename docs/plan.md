# Chess AI Coach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web-based personal chess coach: PGN in → engine+LLM analysis → agentic Socratic coaching session over a board → persistent progress tracking.

**Architecture:** Monorepo (npm workspaces). React SPA + Fastify API + graphile-worker + Stockfish HTTP service + PostgreSQL, deployed by one Helm chart behind oauth2-proxy. The coach is a Vercel AI SDK tool-calling agent. Full detail: `docs/architecture.md`.

**Tech Stack:** Node 22 LTS, TypeScript strict, React 18 + Vite, Fastify 5, PostgreSQL 16, kysely, graphile-worker, zod, Vercel AI SDK (`ai` pkg), chess.js, react-chessboard, Vitest + Testcontainers, Helm.

## Global Constraints

- TypeScript `strict: true`; no `any`; no `enum` keyword (unions + `as const`).
- Layering: route/tool → service → repository. SQL only in `apps/api/src/db/repositories/`.
- All API bodies and jsonb columns validated with zod schemas from `packages/shared`.
- All LLM calls via `apps/api/src/llm/gateway.ts`; prompt text only in `packages/prompts`, matching `docs/prompts.md`.
- Prompt-cache-safe: static system-prompt prefix first, append-only message history (architecture §8.1).
- Model ids, depths, budgets, prices: env config, never hardcoded.
- Mistake taxonomy (closed): `hanging_piece, missed_tactic, allowed_tactic, calculation_error, premature_action, passive_play, pawn_structure, king_safety, piece_activity, endgame_technique, opening_knowledge, no_plan, time_management`.
- Rating bands (closed): `novice, improving, club, advanced`.
- Move quality thresholds (cp loss, capped ±1000): good <50, inaccuracy 50–99, mistake 100–299, blunder ≥300.
- TDD per task; commit after each green task (conventional commits).
- Follow `AGENTS.md` for all style rules.

---

## Phase 0 — Scaffold

### Task 0.1: Monorepo skeleton

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `vitest.workspace.ts`, `eslint.config.js`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces: workspace commands `npm run lint|typecheck|test` at root; `@chess-coach/shared` importable by all workspaces.

- [x] **Step 1: Root package.json with workspaces**

```json
{
  "name": "chess-ai-coach", "private": true,
  "workspaces": ["packages/*", "apps/*", "services/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run", "typecheck": "tsc -b", "lint": "eslint ."
  },
  "devDependencies": { "typescript": "^5.5", "vitest": "^2", "eslint": "^9",
    "typescript-eslint": "^8", "@eslint/js": "^9" }
}
```

- [x] **Step 2: tsconfig.base.json** — `strict`, `noUncheckedIndexedAccess`, `module: NodeNext`, `composite: true`. Each workspace tsconfig extends it with `references`.

- [x] **Step 3: Seed `packages/shared`** with `src/index.ts` exporting a placeholder-free constant to prove the pipeline:

```ts
export const MISTAKE_CATEGORIES = ['hanging_piece','missed_tactic','allowed_tactic',
  'calculation_error','premature_action','passive_play','pawn_structure','king_safety',
  'piece_activity','endgame_technique','opening_knowledge','no_plan','time_management'] as const;
export type MistakeCategory = typeof MISTAKE_CATEGORIES[number];
export const RATING_BANDS = ['novice','improving','club','advanced'] as const;
export type RatingBand = typeof RATING_BANDS[number];
```

And a trivial test `src/index.test.ts` asserting `MISTAKE_CATEGORIES.length === 13`.

- [x] **Step 4: Verify** — `npm install && npm run typecheck && npm test` all pass.

- [x] **Step 5: Commit** — `git init` (if needed), `chore: scaffold monorepo workspaces`.

### Task 0.2: Shared zod schemas

**Files:**
- Create: `packages/shared/src/{game,analysis,coaching-plan,session,finding,user,credits}.ts` + tests
- Modify: `packages/shared/src/index.ts` (re-export all)

**Interfaces:**
- Produces (exact names, used by every later task):
  `EngineEvalSchema`/`EngineEval`, `CoachingPlanSchema`/`CoachingPlan`,
  `SessionOutcomeSchema`/`SessionOutcome`, `FindingSchema`/`Finding`,
  `MoveQuality = 'good'|'inaccuracy'|'mistake'|'blunder'`,
  `ImportGameRequestSchema { pgn: string; source: 'paste'|'upload'|'lichess'; userColor?: 'white'|'black' }`,
  `UserProfileSchema`, `CreditPackSchema ('small'|'medium'|'large')`,
  `ThreadSchema`/`Thread` (conversation-ledger entry, architecture §6.5).

- [x] **Step 1: Write failing tests** — for each schema: a valid fixture parses; an invalid one (bad enum value, missing field, >8 moments) fails. Example:

```ts
import { CoachingPlanSchema } from './coaching-plan';
test('rejects unknown category', () => {
  const plan = validPlanFixture();
  plan.moments[0].category = 'laziness';
  expect(CoachingPlanSchema.safeParse(plan).success).toBe(false);
});
```

- [x] **Step 2: Run tests — fail** (`npm test -w packages/shared`).
- [x] **Step 3: Implement schemas** exactly per `architecture.md` §6 (EngineEval §6.2, CoachingPlan §6.3, SessionOutcome §6.4). Derive types with `z.infer`.
- [x] **Step 4: Tests pass.**
- [x] **Step 5: Commit** — `feat: shared zod schemas for API contracts`.

---

## Phase 1 — Pure chess analysis (`packages/chess-analysis`)

### Task 1.1: PGN parsing → position list

**Files:**
- Create: `packages/chess-analysis/src/pgn.ts`, `pgn.test.ts`, package scaffolding (deps: `chess.js`, `@chess-coach/shared`)

**Interfaces:**
- Produces: `parsePgn(pgn: string): ParsedGame` where
  `ParsedGame = { headers: Record<string,string>; positions: { ply: number; fen: string; moveSan: string|null; moveUci: string|null; mover: 'white'|'black'|null }[] }`
  (positions[0] = start, ply 0, null move). Throws `InvalidPgnError` (exported) on illegal/corrupt PGN.
- Produces: `detectUserColor(headers, usernames: {lichess?: string; chesscom?: string; displayName: string}): 'white'|'black'|null` (case-insensitive match on White/Black headers).

- [x] **Step 1: Failing tests** — Scholar's mate PGN → 8 positions (7 plies + start); multi-game PGN → parses first game; garbage → `InvalidPgnError`; headers extracted; `detectUserColor` matches case-insensitively and returns null when no match.
- [x] **Step 2: Run — fail.**
- [x] **Step 3: Implement with `chess.js`** (`loadPgn`, walk `history({verbose:true})` replaying to collect FENs).
- [x] **Step 4: Run — pass.**
- [x] **Step 5: Commit** — `feat: pgn parsing to position list`.

### Task 1.2: Move classification

**Files:**
- Create: `packages/chess-analysis/src/classify.ts`, `classify.test.ts`

**Interfaces:**
- Consumes: `EngineEval` (shared), `ParsedGame`.
- Produces: `classifyMoves(game: ParsedGame, evals: EngineEval[], userColor): ClassifiedMove[]` where
  `ClassifiedMove = { ply: number; moveSan: string; mover: 'white'|'black'; isUserMove: boolean; cpLoss: number; quality: MoveQuality; bestLineSan: string[]; evalAfterCp: number }`.
- Key logic (write exactly): eval from mover's perspective; `cpLoss = clamp(bestCp - playedCp, 0, 1000)`; mate scores map to ±1000cp before subtraction; thresholds from Global Constraints.

- [x] **Step 1: Failing tests** — hand-built eval fixtures: cpLoss 0 → `good`; 75 → `inaccuracy`; 150 → `mistake`; 400 → `blunder`; mate-missed maps to 1000; black-to-move perspective flip is correct (the classic sign bug — test it explicitly).
- [x] **Step 2: fail.** **Step 3: implement** (small pure functions: `toMoverPerspective`, `mateToCp`, `qualityFor(cpLoss)`). **Step 4: pass.**
- [x] **Step 5: Commit** — `feat: cp-loss move classification`.

### Task 1.3: Critical-moment candidates

**Files:**
- Create: `packages/chess-analysis/src/critical-moments.ts` + test

**Interfaces:**
- Produces: `findCandidateMoments(moves: ClassifiedMove[]): CandidateMoment[]`,
  `CandidateMoment = { ply: number; kind: 'user_mistake'|'turning_point'; cpLoss: number }`.
- Rules (specs §4.2.3): user mistakes/blunders/misses; plies where white-perspective eval crosses ±150. No cap here (planner LLM prioritizes); sorted by ply; deduped by ply (priority: user_mistake > turning_point). (The former `missed_chance` rule — user `good` moves where a ≥300cp better multiPv line existed — was folded into `classify.ts`'s true multi-PV `miss` quality tier as of the 2026-07-30 threshold-retuning spec; any move it would have flagged is now already tagged `miss` and reaches the coaching plan via the `user_mistake` rule instead.)

- [x] **Steps 1–4:** failing tests with fixture games covering each rule + dedup, then implement, then pass.
- [x] **Step 5: Commit** — `feat: critical moment detection`.

---

## Phase 2 — Engine service (`services/engine`)

### Task 2.1: UCI wrapper + pool

**Files:**
- Create: `services/engine/src/uci.ts`, `engine-pool.ts`, tests; `docker/Dockerfile.engine` (node:22-slim + stockfish apt package)

**Interfaces:**
- Produces: `class UciEngine { analyze(fen, {depth, multiPv, timeoutMs}): Promise<EngineEval['lines']> }` (spawns `stockfish` binary path from `STOCKFISH_PATH`, default `/usr/games/stockfish`); `class EnginePool { constructor(size); withEngine<T>(fn): Promise<T> }` (simple queue).
- Timeout returns best-so-far lines from the last `info` output; never rejects on timeout.

- [x] **Step 1: Failing tests** — against real stockfish (CI installs it): startpos depth 8 returns a line with `moveSan` in {e4,d4,Nf3,c4}; mate-in-1 FEN (`k7/8/1K6/8/8/8/8/7R w - - 0 1` → `Rh8#` — corrected from the placeholder above, verified with the engine) reports `mateIn: 1`; pool serializes >size concurrent calls.
- [x] **Steps 2–4:** fail → implement (line parser as its own pure function `parseInfoLine` with unit tests, incl. `score mate -3`) → pass.
- [x] **Step 5: Commit** — `feat: stockfish uci wrapper and pool`.

### Task 2.2: HTTP server

**Files:**
- Create: `services/engine/src/server.ts`, `analyze.ts` + integration test (Fastify `inject`)

**Interfaces:**
- Produces the HTTP contract of architecture §4: `POST /analyze-game {fens, depth?, multiPv?} → {evals}`, `POST /analyze-position → {eval}`, `GET /health`. Env: `ENGINE_POOL_SIZE=2`, `ENGINE_DEFAULT_DEPTH=16`, `ENGINE_MOVE_TIMEOUT_MS=5000`, `PORT=8081`. Bodies validated with shared schemas.

- [x] **Steps 1–4:** failing inject-tests (3 fens → 3 evals in order; bad fen → 400 problem+json) → implement → pass.
- [x] **Step 5: Commit** — `feat: engine http service`.

---

## Phase 3 — API foundation

### Task 3.1: Fastify app + auth headers + errors

**Files:**
- Create: `apps/api/src/{app.ts,server.ts}`, `plugins/{auth-headers.ts,error-mapper.ts}`, `lib/errors.ts`, `apps/api/test/helpers/build-app.ts`, tests

**Interfaces:**
- Produces: `buildApp(opts): FastifyInstance`; `request.user: { email: string; displayName: string }` decorated from `X-Auth-Request-Email`/`X-Auth-Request-User` (401 problem+json if missing and `AUTH_MODE !== 'dev-stub'`; dev-stub injects `dev@local.test`). Error classes: `NotFoundError(404)`, `ValidationError(400)`, `InsufficientCreditsError(402)`, `ConflictError(409)` → problem+json via error-mapper. `GET /healthz` 200 always; `GET /readyz` 200 iff DB ping ok.

- [x] **Steps 1–4:** failing tests (no headers → 401; headers → echoed in a test route; thrown `NotFoundError` → `{status:404, title}`) → implement → pass.
- [x] **Step 5: Commit** — `feat: api skeleton with proxy auth and problem+json errors`.

### Task 3.2: DB layer + migrations + users

**Files:**
- Create: `apps/api/src/db/{index.ts,migrations/0001_initial.ts}`, `db/repositories/{users.ts}`, `services/user-profile.ts`, `routes/users.ts`, `apps/api/test/helpers/db.ts` (Testcontainers), tests

**Interfaces:**
- Produces: migration 0001 = full schema of architecture §3 (all tables incl. `sessions.context_digest`, `llm_call_log.cached_input_tokens`). `usersRepo: { findByEmail, insert, update }`; `userProfileService: { getOrCreate(identity): Promise<User>; getProfileSummary(userId): Promise<{focusAreas, recentFindings, findingCounts, sessionCount}> }` (summary powers prompts + dashboard). Routes: `GET/PATCH /api/users/me`.
- First-login flow: `getOrCreate` inserts with 100-credit `signup_grant` ledger row (same transaction).

- [x] **Steps 1–4:** failing integration tests (fresh container → migrate → `GET /users/me` creates user + grants 100 credits exactly once across two calls; PATCH validates band against `RATING_BANDS`) → implement → pass.
- [x] **Step 5: Commit** — `feat: db schema, users repo, me endpoints`.

### Task 3.3: Game import

**Files:**
- Create: `db/repositories/games.ts`, `services/game-import.ts`, `routes/games.ts`, tests

**Interfaces:**
- Consumes: `parsePgn`, `detectUserColor` (Task 1.1), `ImportGameRequestSchema`.
- Produces: `POST /api/games` → `{gameId, analysisId}` (creates `analyses` row `status:'queued'` + enqueues `analyze-game` job — job runner mocked until Phase 4); `GET /api/games`, `GET /api/games/:id`. `userColor` from request, else `detectUserColor`, else 422 problem+json `{missing:'userColor'}`. Rate limit 10 imports/day (429).

- [x] **Steps 1–4:** failing tests (valid PGN → rows exist, queued; illegal PGN → 400; ambiguous color → 422; 11th import same day → 429) → implement → pass.
- [x] **Step 5: Commit** — `feat: pgn game import`.

### Task 3.4: LLM gateway + key vault

**Files:**
- Create: `apps/api/src/llm/{gateway.ts,key-vault.ts,metering.ts,anthropic.ts,openai.ts}`, `routes/llm-keys.ts`, `db/repositories/{llm-keys.ts,credits.ts}`, `services/credits.ts`, tests

**Interfaces:**
- Produces (used by all LLM callers):
  ```ts
  type Tier = 'standard'|'light';
  getModelForUser(userId: string, tier: Tier): Promise<{ model: LanguageModel;
    metered: boolean; provider: 'anthropic'|'openai' }>
  recordUsage(args: { userId; sessionId?; provider; model; usage: {inputTokens;
    outputTokens; cachedInputTokens}; purpose; metered }): Promise<void>  // ledger+log, atomic
  creditsService: { balance(userId): Promise<number>;
    assertCanSpend(userId): Promise<void> /* throws InsufficientCreditsError */ }
  keyVault: { encrypt(plain): {ciphertext, iv}; decrypt({ciphertext, iv}): string }
  ```
- Metering formula: `credits = ceil((inputTokens - cachedInputTokens + cachedInputTokens/4 + outputTokens) / 1000) * tierMultiplier`; multipliers from env `CREDIT_MULT_STANDARD=1`, `CREDIT_MULT_LIGHT=0.25` (result rounded up to int). Model ids from `LLM_STANDARD_MODEL`/`LLM_LIGHT_MODEL` per provider.
- `PUT/DELETE /api/users/me/llm-keys/:provider` (PUT never echoes the key back).

- [x] **Steps 1–4:** failing tests (vault round-trips and produces distinct IVs; BYOK user → `metered:false` + their provider; no key → platform + `metered:true`; metering math incl. cached-token discount; balance 0 → `assertCanSpend` throws; ledger row + log row written atomically) → implement → pass. Providers via `@ai-sdk/anthropic` / `@ai-sdk/openai` `createAnthropic({apiKey})` etc.
- [x] **Step 5: Commit** — `feat: llm gateway, byok vault, credit metering`.

---

## Phase 4 — Prompts package + analysis pipeline

### Task 4.1: `packages/prompts`

**Files:**
- Create: `packages/prompts/src/{coach-system.ts,analysis-planner.ts,progress-summarizer.ts,engine-interpreter.ts,onboarding-profiler.ts,calibration.ts,render.ts}` + tests

**Interfaces:**
- Produces:
  ```ts
  buildCoachSystemPrompt(input: CoachPromptInput): { staticPart: string; dynamicPart: string }
    // CoachPromptInput = { user: {displayName; selfAssessment; sessionCount},
    //   band: RatingBand, game: GameMeta, plan: CoachingPlan,
    //   focusAreas: FocusArea[], recentFindings: Finding[] }
  buildPlannerMessages(input): { system: string; user: string }
  buildSummarizerMessages(input): { system: string; user: string }
  buildInterpreterMessages(input: { fen; depth; multiPv; engineLines: string;
    question: string }): { system: string; user: string }   // prompts.md §4
  CALIBRATION: Record<RatingBand, { label; description; revealDepthPlies }>
  ```
  Split return (`staticPart`/`dynamicPart`) exists **for cache breakpoints** — gateway callers place `cache_control` after each.
- Text must match `docs/prompts.md` §2/§3/§5/§6 verbatim (templates in code, doc is source of truth).

- [x] **Steps 1–4:** failing tests (staticPart is byte-identical across two different users — cache invariant; dynamicPart contains focus areas and plan moments; empty history renders the "(none yet…)" fallback; all 13 categories appear in each prompt's category list; calibration table matches prompts.md §2.3 values) → implement → pass.
- [x] **Step 5: Commit** — `feat: prompt builders with cache-safe split`.

### Task 4.2: Worker + analyze-game job

**Files:**
- Create: `apps/api/src/jobs/{index.ts,analyze-game.ts}`, `services/analysis.ts`, `db/repositories/analyses.ts`, `routes/analyses.ts` (SSE status), worker entrypoint `apps/api/src/worker.ts`, tests

**Interfaces:**
- Consumes: engine HTTP (Task 2.2, base URL `ENGINE_URL`), `classifyMoves`/`findCandidateMoments` (Phase 1), `buildPlannerMessages` + gateway `light` tier.
- Produces: job `analyze-game {gameId}` implementing architecture §5 steps 1–6 (statuses `queued→engine_running→planning→ready|failed`); zod-validate planner output with **one retry** appending the validation error; `GET /api/analyses/:id/status` SSE emitting `{status}` on change (poll DB 1s, end on terminal).

- [x] **Steps 1–4:** failing integration tests (mock engine HTTP + mock gateway model returning a valid plan → analysis `ready` with stored evals+plan; planner returns invalid JSON once then valid → retry succeeds; twice → `failed` with error; engine 500 → `failed`) → implement → pass.
- [x] **Step 5: Commit** — `feat: analysis pipeline worker`.

---

## Phase 5 — Coach agent + sessions

### Task 5.1: Agent tools layer

**Files:**
- Create: `apps/api/src/services/{coach-tools.ts,progress.ts}`, `db/repositories/{findings.ts,focus-areas.ts,sessions.ts}`, tests

**Interfaces:**
- Produces: `buildCoachTools(ctx: {userId; sessionId; gameId}): ToolSet` — the 8 tools of architecture §7.1 (`update_threads` is built in Task 5.5; stub it schema-only here). Client tools (`show_position`, `annotate_board`) defined schema-only (no execute → forwarded to client). Server tools call services only:
  `progressService: { recordFinding(userId, sessionId, f: Finding); applyFocusAreaUpdate(userId, u: FocusAreaUpdate) }` — the max-3-active rule and category validation live HERE, not in tool code, not in SQL.
- `get_engine_analysis {fen, question}` = engine HTTP call → `buildInterpreterMessages` → gateway **light** tier → returns `[engine check] {text}` (≤80 words). Raw engine lines never returned to the coach (architecture §7.4.4).
- Budget wrappers per architecture §8.3: `withBudget(name, max, fn)` returns `{error:'budget_exhausted — answer with what you have'}` when exceeded; repeat-call breaker caches identical name+args.

- [x] **Steps 1–4:** failing tests (4th active focus-area create → queued not inserted; unknown category → ValidationError; 3rd engine call in one turn → budget error object; identical repeated call → cached result, no second service invocation; engine tool result is the interpreter subagent's text on light tier — asserted via mocked gateway — and contains no raw UCI lines) → implement → pass.
- [x] **Step 5: Commit** — `feat: coach agent tools with budgets and layered services`.

### Task 5.2: Session context compaction

**Files:**
- Create: `apps/api/src/services/session-context.ts` + tests

**Interfaces:**
- Produces: `prepareContext(messages: StoredMessage[], digest: string|null, budgetTokens: number): { digest: string|null; replayMessages: StoredMessage[]; needsCompaction: boolean }` (pure — estimation at 4 chars/token) and `compact(messagesToFold, previousDigest, lightModel): Promise<string>` (≤300-token digest via light tier).
- Consumed by Task 5.3 before each `streamText` call; digest persisted to `sessions.context_digest` + `digest_through_message_id`.

- [x] **Steps 1–4:** failing tests (under budget → all messages, no compaction; over → oldest ~50% marked for folding, newest kept verbatim, digest injected as first message; compaction not re-triggered within 20 turns) → implement → pass.
- [x] **Step 5: Commit** — `feat: rolling session context compaction`.

### Task 5.3: Session routes + agent loop

**Files:**
- Create: `apps/api/src/services/coach-agent.ts`, `routes/sessions.ts`, `db/repositories/session-messages.ts`, tests

**Interfaces:**
- Consumes: everything above. Produces the product core:
  `POST /api/sessions {gameId}` (409 if analysis not ready; synthesizes `[session_start]` message);
  `GET /api/sessions/:id` (messages + current_ply);
  `POST /api/sessions/:id/messages {content}` → SSE stream: AI SDK `streamText({model, system: [staticPart(cache), dynamicPart(cache)], messages, tools, maxSteps: 8, onFinish})`; onFinish persists messages append-only + `recordUsage`; `assertCanSpend` before the call when metered (402 → session `paused_no_credits`).
  `end_session` tool → status `completed`, enqueue `summarize-session`.

- [x] **Steps 1–4:** failing tests with `MockLanguageModel` (session_start → system prompt contains focus areas + plan; model emits `show_position` client tool-call → appears in SSE stream and `current_ply` updates on client tool-result round-trip; tokens metered; balance 0 metered user → 402 + paused; messages persisted verbatim and replayed identically next turn — cache invariant) → implement → pass.
- [x] **Step 5: Commit** — `feat: coach agent session loop over sse`.

### Task 5.4: summarize-session job

**Files:**
- Create: `apps/api/src/jobs/summarize-session.ts`, extend `services/progress.ts`, tests

**Interfaces:**
- Consumes: `buildSummarizerMessages`, gateway light tier, `SessionOutcomeSchema`, `progressService`.
- Produces: job reads transcript + recorded findings → validated `SessionOutcome` → `progressService.applySessionOutcome(sessionId, outcome)` (dedup same category+ply; focus-area state machine `active→improving→resolved`, regress path; summary+homework stored on session).

- [x] **Steps 1–4:** failing tests (dedup skips already-recorded finding; `resolve` action moves state; regress on resolved → active) → implement → pass.
- [x] **Step 5: Commit** — `feat: post-session progress summarizer`.

### Task 5.5: Conversation thread ledger

**Files:**
- Create: `apps/api/src/services/threads.ts`, tests
- Modify: `services/coach-tools.ts` (wire `update_threads` execute), `db/repositories/sessions.ts` (add `updateThreads`, `getThreads`), `services/session-context.ts` (compaction carries threads)

**Interfaces:**
- Consumes: `ThreadSchema` (Task 0.2), `sessions.threads` column (in migration 0001, Task 3.2).
- Produces: `threadsService: { replace(sessionId, threads: Thread[]): Promise<Thread[]> }` — validates via `ThreadSchema.array()`, enforces ≤8 threads and ≤1 `active` (else `ValidationError`); tool returns the stored ledger. `prepareContext` (Task 5.2) gains a rule: when compacting, open/parked thread entries are appended to the digest verbatim; resolved ones dropped.

- [x] **Step 1: Failing tests** — 2 `active` threads → ValidationError; 9 threads → ValidationError; valid replace → persisted and returned; compaction of a history containing an `update_threads` result → digest contains the parked thread's topic and hypothesis, not the resolved one; ledger absent from `GET /api/sessions/:id` client payload (backstage only — messages returned to the UI filter `update_threads` tool frames).
- [x] **Step 2: Run — fail.** **Step 3: Implement** (tool → service → repository; no SQL outside the repo). **Step 4: Run — pass.**
- [x] **Step 5: Commit** — `feat: conversation thread ledger`.

---

## Phase 6 — Web app

**Every task in this phase implements `docs/design.md` — read it first.** Layouts,
breakpoints (768/1080), color/typography tokens, component props, and per-screen
behavior are specified there; do not invent visual design in code.

### Task 6.1: SPA shell + API client

**Files:**
- Create: `apps/web` (Vite react-ts), `src/api/client.ts` (typed fetch using shared schemas), `src/App.tsx` routing (`/import`, `/games`, `/session/:id`, `/dashboard`, `/settings`), `src/components/AppShell.tsx` (design.md §3: bottom tab bar <1080 px, icon rail ≥1080 px), `src/styles/tokens.css` (design.md §2.1 tokens, light+dark), TanStack Query setup, tests (Vitest + Testing Library)

- [x] **Steps 1–5:** failing tests (client parses `/users/me` fixture with `UserProfileSchema`, unknown fields tolerated; AppShell renders tab bar vs rail per viewport — matchMedia mock; tokens.css defines every §2.1 variable in both themes) → implement → pass → commit `feat: web shell, design tokens, typed api client`.

### Task 6.2: Import flow + analysis progress

**Files:**
- Create: `src/features/import/{ImportPage,PgnPasteForm,LichessGamePicker,ColorConfirm}.tsx`, `src/hooks/useAnalysisStatus.ts` (SSE), tests

- [x] **Steps 1–5:** failing tests (paste → POST body matches `ImportGameRequestSchema`; 422 missing color → `ColorConfirm` renders; SSE `ready` → navigate to new session) → implement → pass → commit `feat: game import flow`.

### Task 6.3: Session page — board + chat

**Files:**
- Create: `src/features/session/SessionPage.tsx`, `src/features/board/{CoachBoard,MiniBoard,MoveStrip,AnnotationLayer,ExplorePanel}.tsx`, `src/features/chat/{ChatPane,MessageList,MoveCard,PositionDivider,ToolActivity,SessionSummaryCard}.tsx`, `src/hooks/{useCoachChat.ts,useWasmEngine.ts,useBoardDock.ts}`, tests

**Interfaces:**
- Layout per design.md §5: side-by-side ≥768 px (board ≤640 px + chat column); mobile = board docked top, chat below, `useBoardDock` collapsing to 96 px mini-board on chat scroll-up/keyboard-open and auto-expanding on coach `show_position`.
- `useCoachChat(sessionId)`: wraps AI SDK `useChat` against our SSE endpoint; executes client tools: `show_position {ply}` → set board FEN from game positions + POST tool-result; `annotate_board` → arrows/highlights props for `CoachBoard`; exposes `sendBoardMove(san, fen)` formatting the `[board_move]` message (prompts.md §2.5). `update_threads` and server-tool frames render nothing (design.md §5.3).
- `CoachBoard`: react-chessboard wrapper, props per design.md §6 `{fen, orientation, arrows, highlights, mode:'answer'|'peek', onUserMove}` — presentational only; answer-mode moves show the 2 s undo pill before send (design.md §5.4).
- `MoveStrip {sanMoves, currentPly, momentPlies, onSelect}`: peek-mode navigation; snaps back on next coach `show_position`.
- `useWasmEngine`: lazy-loads stockfish.js in a Web Worker for ExplorePanel; word-based evals only, labeled per design.md §5.6, never sent to server.

- [x] **Steps 1–5:** failing tests (mock SSE emitting show_position → board fen updates + tool-result POSTed + docked board expands; user drags a move in answer mode → undo pill then `[board_move]` sent, in peek mode → nothing sent; annotations clear on next show_position; auto-scroll suppressed when user is scrolled up; `update_threads` frame renders nothing) → implement → pass → commit `feat: coaching session ui`.

### Task 6.4: Dashboard + settings

**Files:**
- Create: `src/features/dashboard/{DashboardPage,FocusAreaCard,TrendChart,SessionHistory}.tsx`, `src/features/settings/{SettingsPage,ByokKeyForm,BandSelect,CreditBalance}.tsx`, api route `GET /api/users/me/dashboard` (+ service/repo methods), tests

- [x] **Steps 1–5:** failing tests (dashboard endpoint aggregates findings per category for last 20 games — SQL in repo only; ByokKeyForm never displays a saved key, only "saved ✓ / delete") → implement → pass → commit `feat: dashboard and settings`.

---

## Phase 7 — Auth & Lichess import

### Task 7.1: Lichess integration

**Files:**
- Create: `apps/api/src/services/lichess.ts`, `routes/lichess.ts`, tests

**Interfaces:**
- Produces: `GET /api/lichess/recent-games` → last 20 games for `users.lichess_username` via `GET https://lichess.org/api/games/user/{u}?max=20&pgnInJson=true` (ndjson parsed; 404 problem+json if no linked username). Frontend `LichessGamePicker` (6.2) consumes it.

- [x] **Steps 1–5:** failing tests (mocked lichess HTTP; ndjson → list; no username → 404) → implement → pass → commit `feat: lichess recent games import`.

### Task 7.2: oauth2-proxy dev-parity config

**Files:**
- Create: `docker-compose.yml` (postgres, engine, api, worker, web-dev, oauth2-proxy in optional profile), `docs/dev-setup.md`

- [x] **Steps 1–5:** compose up with `AUTH_MODE=dev-stub` → end-to-end smoke script (`scripts/smoke.sh`: import PGN → poll ready → create session with mocked LLM env `LLM_FAKE=1` flag in gateway returning canned stream) passes → commit `chore: local dev compose and smoke test`.

---

## Phase 8 — Credits & Stripe

### Task 8.1: Checkout + webhook

**Files:**
- Create: `apps/api/src/routes/{credits.ts,stripe-webhook.ts}`, `services/stripe.ts`, tests

**Interfaces:**
- Produces: `POST /api/credits/checkout {pack: 'small'|'medium'|'large'}` → Stripe Checkout session URL (packs/prices from env `STRIPE_PRICE_SMALL=300credits`, etc.; metadata `{userId, credits}`); `POST /api/stripe/webhook` raw-body, `stripe.webhooks.constructEvent` signature check, `checkout.session.completed` → ledger `+credits` with `stripe_event_id` (unique → replay is a no-op 200).

- [x] **Steps 1–5:** failing tests (mock stripe lib; bad signature → 400; valid event → balance up; same event twice → balance up once) → implement → pass → commit `feat: stripe credit packs`.

---

## Phase 9 — Deploy

### Task 9.1: Dockerfiles + Helm chart

**Files:**
- Create: `docker/Dockerfile.{web,api}` (engine exists from 2.1), `deploy/helm/chess-ai-coach/` per architecture §11 (Chart.yaml deps oauth2-proxy + bitnami postgresql; templates: web/api/worker/engine deployments+services, ingress, networkpolicies, migrate-job pre-install/pre-upgrade hook, existingSecret wiring), `values.yaml` + `values.example.yaml` documenting every key

- [x] **Step 1: Write `helm template` golden tests** (`deploy/helm/test.sh`): rendering with example values succeeds; api env includes `ENGINE_URL`; webhook path is in oauth2-proxy `skip-auth-route`; no secret literals in rendered output.
- [x] **Steps 2–4:** fail → implement chart → pass; validate with `helm lint` and `kubeconform`.
- [x] **Step 5: Commit** — `feat: helm umbrella chart`.

### Task 9.2: CI

**Files:**
- Create: `.github/workflows/ci.yml` (install stockfish, npm ci, lint, typecheck, test w/ Testcontainers, docker build all images, helm lint)

- [ ] **Steps 1–5:** push branch → CI green → commit `chore: ci pipeline`.

---

## Deferred architectural work

### Task #44: PGN sideline/variation support

`parsePgn` (`packages/chess-analysis/src/pgn.ts`) uses chess.js `history()`,
which is strictly linear — `(...)` RAV variations and NAG codes are silently
dropped from the source PGN. Fixing this for real means a variation-tree data
model, not just a parser patch: the flat `positions[]`/`ply`-as-array-index
model is load-bearing across the app —

- DB: `SessionsTable.currentPly`, `FindingsTable.ply`, and every element of
  the `analyses` table's `engineEvals`/`classifiedMoves` JSONB blobs are bare
  `ply: number`, with no variation/line identifier.
- Shared schemas: `EngineEvalSchema`, `ClassifiedMoveSchema`
  (`packages/shared/src/analysis.ts`) are ply-keyed only.
- Coach protocol: the LLM's `show_position { ply }` tool call addresses the
  board by bare ply int (`useSessionBoardState.ts`).
- UI: `MoveExplorer.pairMoves` assumes a flat, gapless SAN array indexed by
  ply − 1 (already comments that sidelines are out of scope there).

No existing design doc covers this — it's greenfield. Before implementing,
decide scope: (a) full variation-tree rewrite touching DB migrations, shared
schemas, the coach tool-call protocol, and the UI; or (b) a narrower first
step — parse variations/NAGs into an auxiliary structure without changing
the flat mainline model, so nothing downstream breaks and sideline data is
at least captured instead of silently dropped. Option (b) is the natural
stepping stone to (a).

### Task #45: Shared bidirectional coach/student board annotations

Not yet scoped in this doc — see task tracker for current status.

## Milestone checkpoints (demo after each)

- **After Phase 2:** script feeds a PGN through parse→engine→classify, prints mistakes. *(First visible value.)*
- **After Phase 4:** import via API returns a stored CoachingPlan.
- **After Phase 5:** full coached session over curl/SSE with a real LLM key.
- **After Phase 6:** the product is usable end-to-end in a browser (dev-stub auth).
- **After Phase 9:** `helm install` on a fresh cluster serves the product behind Google/Lichess login.
