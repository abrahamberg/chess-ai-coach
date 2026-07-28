# Chess AI Coach — Architecture

**Version:** 1.0 · **Date:** 2026-07-28 · Companion to `specs.md` (requirements) and
`plan.md` (build order). Prompt texts live in `prompts.md`.

---

## 1. System overview

```
                        ┌─────────────────────────────────────────────┐
 Internet ──► Ingress ──► oauth2-proxy (Google + Lichess OIDC/OAuth2) │
                        └───────────────┬─────────────────────────────┘
                                        │ X-Auth-Request-* headers
                       ┌────────────────┼──────────────────┐
                       ▼                ▼                   │
                  ┌─────────┐     ┌──────────┐              │
                  │  web    │     │   api    │◄─────────────┘
                  │ (React, │     │(Fastify) │
                  │ static) │     └──┬───┬───┘
                  └─────────┘        │   │ SQL
                   serves SPA;       │   ▼
                   WASM Stockfish    │ ┌────────────┐   ┌──────────────┐
                   runs in-browser   │ │ PostgreSQL │◄──│ worker        │
                                     │ └────────────┘   │(graphile-    │
                                     │        ▲         │ worker jobs) │
                                     ▼        │         └──────┬───────┘
                              ┌────────────┐  └────────────────┤
                              │  engine    │◄──────────────────┘
                              │(Stockfish  │   HTTP (cluster-internal)
                              │ HTTP svc)  │
                              └────────────┘
             External: Anthropic API · OpenAI API · Stripe · Lichess API
```

Five deployables: `web`, `api`, `worker`, `engine`, plus `oauth2-proxy` and
`postgresql` from upstream charts.

## 2. Repository layout (monorepo, npm workspaces)

```
chess-ai-coach/
├── AGENTS.md                  # coding standards for AI + human contributors
├── package.json               # workspaces root; shared scripts (lint, test, build)
├── tsconfig.base.json         # strict TS config all packages extend
├── docs/                      # specs.md, architecture.md, plan.md, prompts.md
├── apps/
│   ├── web/                   # React SPA (Vite)
│   │   └── src/
│   │       ├── components/    # dumb presentational components
│   │       ├── features/      # feature folders: board/, chat/, dashboard/, import/, settings/
│   │       ├── hooks/         # useSession, useAnalysisStatus, useWasmEngine, ...
│   │       ├── api/           # typed fetch client (generated from shared schemas)
│   │       └── lib/           # pure helpers (fen utils, formatting)
│   └── api/                   # Fastify server
│       └── src/
│           ├── routes/        # one file per resource: games.ts, sessions.ts, users.ts,
│           │                  #   analyses.ts, credits.ts, stripe-webhook.ts, health.ts
│           ├── services/      # business logic, one file per domain:
│           │                  #   game-import.ts, analysis.ts, coach-agent.ts,
│           │                  #   progress.ts, credits.ts, user-profile.ts
│           ├── llm/           # provider gateway: gateway.ts, anthropic.ts, openai.ts,
│           │                  #   metering.ts, key-vault.ts
│           ├── db/            # kysely instance, migrations/, repositories/
│           ├── plugins/       # fastify plugins: auth-headers.ts, error-mapper.ts, sse.ts
│           └── jobs/          # graphile-worker task definitions: analyze-game.ts,
│                              #   summarize-session.ts
├── services/
│   └── engine/                # standalone Stockfish HTTP service (own Dockerfile)
│       └── src/               # server.ts, engine-pool.ts, analyze.ts, uci.ts
├── packages/
│   ├── shared/                # zod schemas + derived TS types; the API contract.
│   │   └── src/               #   game.ts, analysis.ts, session.ts, finding.ts,
│   │                          #   coaching-plan.ts, user.ts, credits.ts, api.ts
│   ├── chess-analysis/        # pure functions: pgn parsing, cp-loss classification,
│   │   └── src/               #   critical-moment detection. No I/O. Fully unit-tested.
│   └── prompts/               # prompt templates + builders (see prompts.md)
│       └── src/               #   coach-system.ts, analysis-planner.ts,
│                              #   progress-summarizer.ts, calibration.ts, tools.ts
├── deploy/
│   └── helm/chess-ai-coach/   # umbrella chart
│       ├── Chart.yaml         # deps: oauth2-proxy, postgresql (bitnami)
│       ├── values.yaml
│       └── templates/         # web.yaml, api.yaml, worker.yaml, engine.yaml,
│                              #   ingress.yaml, networkpolicy.yaml, secrets.yaml,
│                              #   migrate-job.yaml
└── docker/                    # Dockerfile.web, Dockerfile.api, Dockerfile.engine
```

**Rules:** `packages/*` never import from `apps/*`. `apps/web` and `apps/api` share
types only through `packages/shared`. `packages/chess-analysis` is pure (no network,
no DB) so it is trivially testable and reusable by both worker and engine tooling.

## 3. Data model (PostgreSQL 16, migrations via `kysely` + `kysely-ctl`)

```sql
-- users & identity
users (
  id            uuid PK default gen_random_uuid(),
  email         text UNIQUE NOT NULL,          -- from oauth2-proxy header
  display_name  text NOT NULL,
  rating_band   text NOT NULL CHECK (rating_band IN
                  ('novice','improving','club','advanced')) DEFAULT 'improving',
  lichess_username   text,                     -- nullable; set at onboarding
  chesscom_username  text,
  self_assessment    text,                     -- free text from onboarding
  created_at    timestamptz NOT NULL DEFAULT now()
)

user_llm_keys (
  user_id      uuid FK→users NOT NULL,
  provider     text NOT NULL CHECK (provider IN ('anthropic','openai')),
  key_ciphertext bytea NOT NULL,               -- AES-256-GCM, master key from env
  key_iv         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
)

-- games & analysis
games (
  id           uuid PK,
  user_id      uuid FK→users NOT NULL,
  pgn          text NOT NULL,                  -- verbatim as imported
  source       text NOT NULL CHECK (source IN ('paste','upload','lichess')),
  user_color   text NOT NULL CHECK (user_color IN ('white','black')),
  white_name   text, black_name   text,
  result       text,                           -- '1-0','0-1','1/2-1/2','*'
  time_control text, eco text, played_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
)

analyses (
  id            uuid PK,
  game_id       uuid FK→games UNIQUE NOT NULL, -- one analysis per game
  status        text NOT NULL CHECK (status IN
                  ('queued','engine_running','planning','ready','failed')),
  error         text,
  engine_evals  jsonb,   -- EngineEval[] — one entry per ply, schema §6.2
  coaching_plan jsonb,   -- CoachingPlan  — schema §6.3
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
)

-- coaching sessions
sessions (
  id          uuid PK,
  game_id     uuid FK→games NOT NULL,
  user_id     uuid FK→users NOT NULL,
  status      text NOT NULL CHECK (status IN ('active','completed','paused_no_credits')),
  current_ply int  NOT NULL DEFAULT 0,         -- last board position shown
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
)

session_messages (
  id          bigserial PK,
  session_id  uuid FK→sessions NOT NULL,
  role        text NOT NULL CHECK (role IN ('user','assistant','tool')),
  content     jsonb NOT NULL,                  -- AI-SDK message format, stored verbatim
  created_at  timestamptz NOT NULL DEFAULT now()
)

-- progress memory (what makes the coach "know the user")
findings (
  id          uuid PK,
  user_id     uuid FK→users NOT NULL,
  session_id  uuid FK→sessions,
  game_id     uuid FK→games,
  category    text NOT NULL,                   -- taxonomy enum, specs §4.4.2
  severity    text NOT NULL CHECK (severity IN ('minor','significant','critical')),
  ply         int,
  description text NOT NULL,                   -- one sentence, written by the agent
  is_positive boolean NOT NULL DEFAULT false,  -- true = improvement observed
  created_at  timestamptz NOT NULL DEFAULT now()
)
CREATE INDEX findings_user_category ON findings(user_id, category, created_at);

focus_areas (
  id             uuid PK,
  user_id        uuid FK→users NOT NULL,
  category       text NOT NULL,                -- same taxonomy
  status         text NOT NULL CHECK (status IN ('active','improving','resolved')),
  note           text NOT NULL,                -- coach's working note, e.g. "stops
                                               -- calculating after first capture"
  evidence_count int NOT NULL DEFAULT 1,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, category)
)

-- credits
credit_ledger (
  id              bigserial PK,
  user_id         uuid FK→users NOT NULL,
  delta           int NOT NULL,                -- + purchase/grant, - usage
  reason          text NOT NULL CHECK (reason IN
                    ('signup_grant','purchase','session_usage','refund')),
  session_id      uuid,
  stripe_event_id text UNIQUE,                 -- idempotency for webhooks
  created_at      timestamptz NOT NULL DEFAULT now()
)
-- balance = SELECT COALESCE(SUM(delta),0) FROM credit_ledger WHERE user_id = $1

llm_call_log (
  id           bigserial PK,
  user_id      uuid NOT NULL, session_id uuid,
  provider     text NOT NULL, model text NOT NULL,
  input_tokens int NOT NULL, output_tokens int NOT NULL,
  credits_metered int NOT NULL DEFAULT 0,      -- 0 for BYOK
  purpose      text NOT NULL,                  -- 'coach_turn','analysis_plan','summary'
  created_at   timestamptz NOT NULL DEFAULT now()
)
```

## 4. Engine service (`services/engine`)

Small standalone Node service wrapping a pool of Stockfish 16 processes (official
binary in the Docker image, N processes = `ENGINE_POOL_SIZE`, default 2, UCI over
stdio). Stateless; cluster-internal only.

```
POST /analyze-game    { fens: string[], depth?: number, multiPv?: number }
  → { evals: EngineEval[] }                 # sequential per-position analysis
POST /analyze-position{ fen: string, depth?: number, multiPv?: number }
  → { eval: EngineEval }                    # used live by the coach agent tool
GET  /health          → { status: "ok", poolSize, busy }
```

Defaults: depth 16, multiPv 2. Per-position timeout 5 s (returns best-so-far).
`EngineEval` schema in §6.2. Long game analyses are called by the **worker**, live
single positions by the **api** (agent tool) — same service, two endpoints.

The **browser WASM engine** (`stockfish.js` via `apps/web/src/hooks/useWasmEngine.ts`)
is UX-only: instant feedback when the user explores variations on the board. Its evals
are never persisted and never shown as authority — the coach's numbers always come
from the server engine.

## 5. Analysis pipeline (worker)

`graphile-worker` runs in its own deployment, same codebase as `api` (shared
`apps/api/src` build, different entrypoint). Job `analyze-game`:

1. Set `analyses.status = 'engine_running'`.
2. Parse PGN → FEN list (`packages/chess-analysis`).
3. `POST engine/analyze-game` → store `engine_evals`.
4. Pure classification (`packages/chess-analysis`): per-move cp-loss, move quality
   labels, candidate critical moments (specs §4.2.2–4.2.3).
5. Set `status='planning'`; call analysis-planner LLM (prompt in `prompts.md` §3) with
   engine data + user profile summary → validate output against `CoachingPlanSchema`
   (zod, one retry on validation failure with the error appended) → store
   `coaching_plan`, `status='ready'`.
6. On any error: `status='failed'`, `error` set; client shows retry button.

Job `summarize-session` (fired when a session completes): progress-summarizer LLM
(prompt §5) reads the transcript → emits findings + focus-area updates → service layer
applies them (max-3-active rule enforced in code, not by the LLM).

## 6. Shared schemas (`packages/shared`, zod — single source of truth)

### 6.1 Conventions
Every API request/response body and every jsonb column has a zod schema here. Types are
`z.infer<>` — no hand-written duplicate interfaces.

### 6.2 EngineEval
```ts
const EngineEvalSchema = z.object({
  ply: z.number().int(),          // position after this ply (0 = start)
  fen: z.string(),
  depth: z.number().int(),
  lines: z.array(z.object({      // length = multiPv
    moveUci: z.string(),          // e.g. "e2e4"
    moveSan: z.string(),          // e.g. "e4"
    cp: z.number().nullable(),    // centipawns, white-positive; null if mate
    mateIn: z.number().nullable() // +N white mates in N, -N black mates in N
  }))
});
```

### 6.3 CoachingPlan (analysis-planner output)
```ts
const CoachingPlanSchema = z.object({
  gameSummary: z.string(),            // 2-3 sentences, coach-internal
  openingNote: z.string(),            // what to say about the opening phase
  themes: z.array(z.enum(MISTAKE_CATEGORIES)).max(3),  // this game's themes
  connectionToHistory: z.string(),    // how this game relates to focus areas
  moments: z.array(z.object({
    ply: z.number().int(),            // position BEFORE the user's move
    kind: z.enum(['user_mistake','missed_chance','turning_point','instructive']),
    category: z.enum(MISTAKE_CATEGORIES).nullable(),
    whatHappened: z.string(),         // coach-internal note
    socraticQuestion: z.string(),     // the opening question to ask here
    keyLine: z.string(),              // best line in SAN, to reveal after user answers
    revealDepthPlies: z.number().int() // band-calibrated: how much of keyLine to show
  })).min(1).max(8)
});
```

### 6.4 Finding / FocusAreaUpdate (progress-summarizer output)
```ts
const SessionOutcomeSchema = z.object({
  sessionSummary: z.string(),                    // shown to user on dashboard
  homework: z.string().nullable(),
  findings: z.array(z.object({
    category: z.enum(MISTAKE_CATEGORIES),
    severity: z.enum(['minor','significant','critical']),
    ply: z.number().int().nullable(),
    description: z.string(),
    isPositive: z.boolean()
  })).max(10),
  focusAreaUpdates: z.array(z.object({
    category: z.enum(MISTAKE_CATEGORIES),
    action: z.enum(['create','progress','regress','resolve']),
    note: z.string()
  })).max(4)
});
```

## 7. The coach agent (`apps/api/src/services/coach-agent.ts`)

The heart of the product. Implemented with the **Vercel AI SDK** (`ai` package, latest
stable) `streamText` loop with tools, `maxSteps: 8` per user turn, streamed to the
client over SSE (`POST /api/sessions/:id/messages` returns `text/event-stream`).

```
System prompt  = buildCoachSystemPrompt({ user, profile, game, coachingPlan, band })
                 (packages/prompts — full text in prompts.md §2)
Messages       = persisted session_messages (AI-SDK format, verbatim)
Model          = via llm/gateway.ts → user's BYOK provider, else platform key + metering
```

### 7.1 Agent tools (definitions in `packages/prompts/src/tools.ts`)

| Tool | Parameters | Effect |
|------|-----------|--------|
| `show_position` | `{ ply: number }` | Client tool: board animates to that ply. Also updates `sessions.current_ply`. |
| `annotate_board` | `{ arrows: {from,to,color}[], highlights: {square,color}[] }` | Client tool: draw on the board. Cleared on next `show_position`. |
| `get_engine_analysis` | `{ fen: string, question: string }` | Server tool backed by a **light-model subagent**: calls the engine, then the engine-interpreter subagent (prompts.md §4) digests the raw lines into ≤80 words answering the coach's `question`. Raw UCI/multiPV output never enters the coach's context. |
| `get_user_profile` | `{}` | Server tool: focus areas + last 15 findings + per-category counts (last 20 games) + session count. |
| `record_finding` | `Finding` (schema §6.4) | Server tool: insert into `findings`. |
| `propose_focus_area_update` | `FocusAreaUpdate` (§6.4) | Server tool: applied by `progress.ts` service (enforces max-3-active). |
| `end_session` | `{ summary: string, homework: string \| null }` | Server tool: marks session completed, enqueues `summarize-session` job. |

Client tools (`show_position`, `annotate_board`) execute on the frontend: the SSE
stream carries the tool call; the client executes and answers with a tool result
(AI SDK client-tools pattern). Server tools execute inside the loop.

**Layering rule (hard):** tool `execute` functions contain **no SQL and no direct DB
access**. They are thin adapters that call service functions (`services/progress.ts`,
`services/user-profile.ts`, `services/analysis.ts`), which in turn call repositories
(`db/repositories/*`) — the **only** place kysely queries may exist. This keeps every
tool testable with a mocked service, keeps invariants (max-3-active focus areas,
enum validation, dedup) in one place, and means the agent can never be prompted into
issuing arbitrary queries.

```
agent tool → service function (invariants, validation) → repository (SQL) → DB
```

### 7.2 Turn flow

```
user message (text | board_move)
  → load session messages + system prompt
  → check credits (if metered): balance > 0 else 402 → paused_no_credits
  → streamText({ model, system, messages, tools, maxSteps: 8 })
  → stream deltas + tool calls to client (SSE)
  → onFinish: persist new messages, log tokens, meter credits
```

### 7.3 Session opening
When a session is created, the server synthesizes the first "user" message:
`{type:"session_start"}`. The system prompt instructs the coach how to open (greet,
connect to history, show starting position, begin walkthrough) — see prompts.md §2.4.

### 7.4 Coach-agent runtime management (cost ⇄ effectiveness)

The coach runs on the expensive standard-tier model, so the runtime is designed to
keep that model's context **small, stable, and cache-friendly**, and to push every
mechanical subtask down to cheap light-tier subagents. These four mechanisms are the
implementation contract for the agent loop (details in §8.1–8.3):

1. **Input caching (§8.1).** The coach's prompt is three cache-stable segments —
   static instructions+tools (identical for everyone) → session block (identical
   within a session) → append-only conversation. Cache breakpoints after segments
   1 and 2. From turn 2 onward the coach pays cache-read prices for ~90% of input.
   Anything that would vary per-turn (credit balance, timestamps) is **banned** from
   the system prompt.

2. **Context management (§8.2).** The conversation replayed to the coach is bounded
   (24k-token budget). Older turns are folded into a ≤300-token rolling digest by a
   light-model subagent; the coach always sees: system prompt → digest → recent
   turns verbatim. The coach never receives raw engine dumps, full PGNs of other
   games, or full profile history — tools return pre-digested summaries sized for
   conversation, never rows.

3. **Loop management (§8.3).** `maxSteps: 8`, per-turn tool budgets (2 engine
   checks, 1 profile read), a repeat-call breaker, an engine LRU, and a per-session
   daily credit ceiling. A well-behaved turn is 1–3 steps; the guardrails exist so
   a confused model degrades to a cheap answer, never to a spend spiral.

4. **Subagents on lower models.** The coach *delegates* instead of ingesting:

   | Subagent | Tier | Trigger | Contract |
   |----------|------|---------|----------|
   | Engine interpreter | light | inside `get_engine_analysis` | raw engine lines + coach's question → ≤80-word chess answer (prompts.md §4) |
   | Context compactor | light | budget exceeded (§8.2) | old turns → rolling digest |
   | Analysis planner | light | before the session (worker) | engine data → CoachingPlan — the session's "prep" so the coach rarely needs live engine calls at all |
   | Progress summarizer | light | after the session (worker) | transcript → findings/focus-area updates — the coach doesn't spend expensive turns on bookkeeping it already did via `record_finding` |

   Rule of thumb encoded in code review: **if a tool result would exceed ~120 words
   or contain non-conversational data (UCI lines, JSON rows), a light subagent must
   digest it before it reaches the coach's context.**

## 8. LLM gateway (`apps/api/src/llm/`)

- `gateway.ts` — `getModelForUser(userId, tier)`: returns an AI-SDK model instance.
  Resolution: user BYOK key (Anthropic preferred if both) → platform key with metering.
- Tiers: `standard` (Claude Sonnet class / GPT-4.1 class) for coach turns;
  `light` (Claude Haiku class / GPT-4.1-mini class) for analysis-planner and
  summarizer. Model ids are config (`LLM_STANDARD_MODEL`, `LLM_LIGHT_MODEL`), never
  hardcoded.
- `metering.ts` — wraps `onFinish` usage: `credits = ceil(totalTokens / 1000) *
  tierMultiplier` (standard ×1... light ×0.25, both configurable); appends
  `credit_ledger` + `llm_call_log` atomically.
- `key-vault.ts` — AES-256-GCM encrypt/decrypt with `LLM_KEY_MASTER_KEY` (32-byte
  base64 env var).

### 8.1 Prompt caching (input-token cost control)

The coach system prompt is large (~2–3k tokens) and every turn resends the whole
conversation, so caching is mandatory, not an optimization:

- **Stable-prefix ordering.** The system prompt is built in two parts:
  (1) the static coaching instructions + tool definitions — byte-identical for every
  user and every turn; (2) the dynamic block (user profile, game, coaching plan) —
  identical for every turn *within a session*. Static part first, dynamic second,
  conversation last. Never interleave per-turn data into the system prompt.
- **Anthropic**: set a `cache_control: {type: "ephemeral"}` breakpoint (via AI SDK
  `providerOptions.anthropic`) after the static block and after the dynamic block.
  Turn N then pays cache-read price for everything except the newest messages.
- **OpenAI**: automatic prefix caching — the same ordering rule gets the discount
  for free.
- **Do not mutate history.** `session_messages` are append-only and replayed
  verbatim; editing an old message invalidates the cache for the whole suffix.
- `llm_call_log` gains `cached_input_tokens int NOT NULL DEFAULT 0`; metering charges
  cached input at ¼ rate. The admin spend query must show cache hit-rate — a
  regression here is a cost bug.

### 8.2 Context management (long sessions)

A full session can reach 60+ turns. Unbounded replay is slow and expensive:

- **Budget:** target ≤ 24k tokens of conversation history per request
  (`SESSION_CONTEXT_BUDGET_TOKENS`, estimated at 4 chars/token — no tokenizer dep).
- **Rolling compaction:** when the budget is exceeded, a light-tier call summarizes
  the oldest ~50% of turns into a "session so far" digest (≤300 tokens: positions
  covered, student's answers, findings recorded, coaching threads still open). The
  digest is stored in `sessions.context_digest text` and injected at the top of the
  message list; the summarized messages are excluded from replay (marked by
  `sessions.digest_through_message_id bigint`). Raw messages are never deleted —
  the UI still shows full history.
- Compaction runs at most once per 20 turns and reuses the previous digest as input
  (incremental, cheap). This is the same pattern as agent-framework "memory
  compression" — implemented in `services/session-context.ts`, unit-testable pure
  function over messages + budget.

### 8.3 Loop management (agent-turn guardrails)

`streamText` is configured so a confused model cannot burn money:

- `maxSteps: 8` per user turn (a normal turn uses 1–3).
- **Per-turn tool budget** enforced in tool wrappers: max 2 `get_engine_analysis`
  calls and 1 `get_user_profile` call per turn; over budget → the tool returns
  `{error: "budget_exhausted — answer with what you have"}` instead of executing.
- **Repeat-call breaker:** identical tool name + args twice in one turn → second
  call returns the cached first result with a note; three times → the turn is
  finalized with whatever text exists.
- **Engine result cache:** `analyze-position` results memoized in an LRU (keyed
  `fen|depth|multiPv`, size 5k) in the api process — repeated student explorations
  of the same position are free.
- Per-session daily ceiling: `MAX_CREDITS_PER_SESSION_DAY` (default 200) even for
  BYOK (protects the user's own key from a runaway loop); exceeding it pauses the
  session with an explanatory message.

### 8.4 Model routing — right-sized models per job

Only the live coach conversation gets the standard-tier model. Everything auxiliary
runs on the light tier (≈10–20× cheaper), like subagents doing prep work for the
main agent:

| Job | Tier | Why it's safe on a small model |
|-----|------|-------------------------------|
| Coach turns (agent loop) | standard | quality is the product |
| Analysis planner | light | structured extraction over engine data; zod-validated with retry |
| Progress summarizer | light | structured extraction over transcript; validated |
| Context compaction (§8.2) | light | summarization, internal-only |
| Onboarding profiler | light | tiny, validated |

Tier→model ids are env config; both tiers resolve through the same gateway so BYOK
and metering behave identically.

## 9. API surface (all under `/api`, identity from proxy headers)

```
POST /games                    import PGN  → { gameId, analysisId }
GET  /games                    list user's games
GET  /games/:id                game + analysis status
GET  /analyses/:id/status      SSE: analysis progress events
POST /sessions                 { gameId } → creates session (requires analysis ready)
GET  /sessions/:id             session + messages + current board state
POST /sessions/:id/messages    { content } → SSE stream of coach response
GET  /users/me                 profile, band, balance, focus areas
PATCH/users/me                 update band, usernames, self_assessment
PUT  /users/me/llm-keys/:provider   store key   DELETE ... remove
GET  /users/me/dashboard       findings trends, focus areas, session history
POST /credits/checkout         { pack } → Stripe Checkout URL
POST /stripe/webhook           raw-body Stripe webhook (signature verified)
GET  /lichess/recent-games     proxy to Lichess API for linked users
GET  /healthz /readyz          probes
```

Errors: RFC 7807 problem+json via a single Fastify error-mapper plugin. Validation:
every route parses body/params with the shared zod schemas.

## 10. Frontend structure (`apps/web`)

- **features/import** — PGN paste/upload, Lichess game picker, side-detection confirm.
- **features/board** — `CoachBoard` (react-chessboard wrapper), annotations layer,
  move-input mode, WASM-engine exploration panel (collapsed by default).
- **features/chat** — streaming chat (AI SDK `useChat` against our SSE endpoint),
  renders tool activity subtly ("👀 coach is checking a line…").
- **features/session** — `SessionPage` composes board + chat; owns board↔agent wiring:
  executes client tool calls, sends `board_move` messages.
- **features/dashboard** — trends chart (Recharts), focus-area cards, session list.
- **features/settings** — band, usernames, BYOK keys, credit purchase.
- State: TanStack Query for server state; no global store (component state + URL).

## 11. Kubernetes / Helm

Umbrella chart `deploy/helm/chess-ai-coach`, dependencies pinned:
`oauth2-proxy` (official chart), `postgresql` (bitnami).

- **web**: nginx serving the Vite build. 2 replicas.
- **api**: 2 replicas; HPA on CPU. Readiness = `/readyz` (checks DB).
- **worker**: 1 replica (scale by queue depth later).
- **engine**: 1–3 replicas; CPU requests = poolSize cores; HPA on CPU.
- **migrate-job**: Helm hook `pre-upgrade,pre-install` runs `kysely migrate:latest`.
- **NetworkPolicy**: api/worker/engine accept traffic only from in-cluster sources;
  only oauth2-proxy is ingress-exposed; engine accepts only api+worker.
- **Secrets**: `platform-llm-keys`, `llm-key-master-key`, `stripe`, `oauth-clients`,
  `postgres-credentials` — templated `existingSecret` pattern, never values.yaml
  defaults with real keys.
- oauth2-proxy: Google OIDC + Lichess as generic OAuth2 provider
  (`https://lichess.org/oauth`); `--set-xauthrequest` to forward identity headers;
  `--skip-auth-route` for `/api/stripe/webhook` and probes.
- Local dev: `docker-compose.yml` with postgres + engine + header-stub; no k8s needed
  for daily work.

## 12. Security notes

- API refuses requests lacking proxy headers unless `AUTH_MODE=dev-stub`.
- Stripe webhook: raw-body signature verification; skip-auth path but validated.
- BYOK keys: encrypted at rest, decrypted only in-process at call time, redacted from
  logs by a serializer that masks `sk-*`/`key`-like fields.
- Prompt-injection surface: PGN content and user chat are untrusted; the system prompt
  instructs the coach to treat game text as data (prompts.md §2.6); tools that mutate
  state (`record_finding`, `propose_focus_area_update`, `end_session`) validate
  against closed enums server-side.
- Rate limits: 10 game imports/day and 60 coach turns/hour per user (config).
