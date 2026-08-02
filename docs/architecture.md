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
  status      text NOT NULL CHECK (status IN ('active','completed','paused_no_credits','abandoned')),
  current_ply int  NOT NULL DEFAULT 0,         -- last board position shown
  threads     jsonb NOT NULL DEFAULT '[]',     -- Thread[] — conversation ledger, §6.5
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz                      -- set on 'completed' and 'abandoned', §7.3a
)

session_messages (
  id          bigserial PK,
  session_id  uuid FK→sessions NOT NULL,
  role        text NOT NULL CHECK (role IN ('user','assistant','tool')),
  content     jsonb NOT NULL,                  -- AI-SDK message format, stored verbatim
  ply         int,                             -- current_ply when this row was written
                                                -- (§7.4/§8.1: episode boundary tag)
  created_at  timestamptz NOT NULL DEFAULT now()
)
-- append-only: never mutated, never reordered, never deleted (§8.1).

-- coach context restructure (docs/superpowers/specs/2026-07-31-coach-
-- context-restructure-design.md): one rolling note per (session, ply),
-- replacing the old sessions.context_digest/digest_through_message_id
-- whole-session digest columns (dropped by migration 0006). Written either
-- by the coach's own record_move_note tool call, or automatically when an
-- episode closes with no such call (§7.4).
session_move_notes (
  id          uuid PK,
  session_id  uuid FK→sessions NOT NULL,
  ply         int NOT NULL,
  note        text NOT NULL,                  -- ≤300 chars if coach-authored (tools.ts)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, ply)
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

### 6.5 Thread (conversation ledger entry)
```ts
const ThreadSchema = z.object({
  id: z.number().int(),                 // coach-assigned, stable within a session
  topic: z.string().max(200),           // coach's shorthand, e.g. "branch 14.Nxd5"
  status: z.enum(['active','parked','resolved']),
  hypothesis: z.string().max(300).nullable(), // diagnosis being tested, if any
  anchorPly: z.number().int().nullable(),     // board position to restore on resume
  anchorFen: z.string().nullable()            // for off-game branches (explored lines)
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
| `show_position` | `{ moveNumber: number, color: 'white' \| 'black' \| null }` | Client tool: board animates to that move (game start is `{ moveNumber: 0, color: null }`). Also updates `sessions.current_ply`. The persisted tool-result is stamped server-side with the position's authoritative `fen` (`services/game-positions.ts`, replayed straight from the game's PGN) before it re-enters the coach's context — this is the coach's only verified ground truth for a position, delivered in-band and cache-safe the same way the thread ledger is (§7.5), never trusted from the client or reconstructed by the model. |
| `check_position` | `{ moveNumber: number, color: 'white' \| 'black' \| null }` | Server tool, same address shape as `show_position`: returns `{ fen, moveSan }` for any move in the game without moving the student's board. Lets the coach get a verified `fen` (e.g. for `get_engine_analysis`) or double-check a claim before making it, instead of guessing. |
| `annotate_board` | `{ arrows: {from,to,color}[], highlights: {square,color}[] }` | Client tool: draw on the board. Cleared on next `show_position`. |
| `expect_move` | `{}` | Client tool: arms a one-shot flag so the student's next board move is sent immediately (today's instant board-move path) instead of accumulating into a diverged line. Ephemeral, client-only — never touches `sessions.current_ply` or any table. |
| `hypothetical_line` | `{ moves: string[] }` (1–12 SAN moves) | Client tool: sets up or continues a diverged line off the current position (or an already-active hypothetical) — e.g. "if Black had played a4 instead". The client resolves the SAN sequence via chess.js (never a coach-supplied FEN, same ground-truth discipline as `show_position`) and returns the resulting position. Purely client-side/ephemeral — no DB row, no PGN-sideline data model (that's the separate, deferred Task #44 in `docs/plan.md`); resets on page reload. |
| `get_engine_analysis` | `{ fen: string, question: string }` | Server tool backed by a **light-model subagent**: calls the engine (requesting 3 principal variations — `COACH_ENGINE_MULTI_PV`), then the engine-interpreter subagent (prompts.md §4) digests the raw lines into ≤80 words answering the coach's `question`. Raw UCI/multiPV output never enters the coach's context. The coach is instructed to source `fen` from `show_position`/`check_position` only, never to reconstruct one itself, and can ask for top candidate moves directly ("what are the best moves here?"). |
| `get_user_profile` | `{}` | Server tool: focus areas + last 15 findings + per-category counts (last 20 games) + session count. |
| `record_finding` | `Finding` (schema §6.4) | Server tool: insert into `findings`. |
| `propose_focus_area_update` | `FocusAreaUpdate` (§6.4) | Server tool: applied by `progress.ts` service (enforces max-3-active). |
| `update_threads` | `{ threads: Thread[] }` (§6.5) | Server tool: full-replace of the session's conversation-thread ledger (`sessions.threads`). Service enforces: ≤8 threads, ≤1 `active`, valid statuses. Returns the stored ledger. Backstage only — never rendered to the student. |
| `record_move_note` | `{ moveNumber, color, note: string }` (same address as `show_position`, note ≤300 chars) | Server tool: coach-authored one-sentence note on a move it's about to leave, upserted into `session_move_notes`. Discretionary, like `record_finding`. |
| `recall_move` | `{ moveNumber: number, color: 'white' \| 'black' \| null }` (same address as `show_position`) | Server tool: on-demand deeper lookup for a specific past move — a fresh light-tier digest of that episode's raw messages, richer than the always-present other-moves-summary line. Budgeted at 3 calls/turn (§8.3). |
| `end_session` | `{ summary: string, homework: string \| null }` | Server tool: marks session completed, enqueues `summarize-session` job. |

Client tools (`show_position`, `annotate_board`, `expect_move`,
`hypothetical_line`) execute on the frontend: the SSE stream carries the tool
call; the client executes and answers with a tool result (AI SDK client-tools
pattern). Server tools execute inside the loop.

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

### 7.3a Resuming and resetting a session

`POST /api/sessions` is find-or-create (`coachAgent.resumeOrCreateSession`): if the user
already has a session in `'active'` or `'paused_no_credits'` status for that game, it is
returned as-is rather than creating a second session over the same game. This is what
lets the Games page treat a "ready" row's click as "open my ongoing session" instead of
always starting a new one — no separate lookup endpoint or frontend branching needed.

`POST /api/sessions/:id/reset` (`coachAgent.resetSession`) lets the student explicitly
abandon the current session and start over: it sets the session's status to
`'abandoned'` (`sessionsRepo.markAbandoned` — endedAt stamped, distinct from `'completed'`
so the dashboard's completed-session history, which expects a real coach summary, never
picks up a reset) and creates a fresh session for the same game. 409s if the session is
already `'completed'`/`'abandoned'`. The "Reset session" control lives in `SessionHeader`.

### 7.4 Coach-agent runtime management (cost ⇄ effectiveness)

The coach runs on the expensive standard-tier model, so the runtime is designed to
keep that model's context **small, stable, and cache-friendly**, and to push every
mechanical subtask down to cheap light-tier subagents. These four mechanisms are the
implementation contract for the agent loop (details in §8.1–8.3):

1. **Input caching (§8.1).** As of the coach context restructure
   (docs/superpowers/specs/2026-07-31-coach-context-restructure-design.md), the
   coach's prompt is five layers, four of them cache-stable: static
   instructions+tools → dynamic session block → annotated PGN → other-moves
   summary → uncached current-position/thread-ledger block → the current
   episode's own conversation. Cache breakpoints after each of the first four
   (Anthropic's per-request maximum — see prompts.md §2.7 for the full layer
   contract). From turn 2 onward the coach pays cache-read prices for most of
   its input. Anything that would vary per-turn (credit balance, timestamps)
   is **banned** from the cached layers.

2. **Context management (§8.2).** Each episode's own conversation is bounded
   (6k-token budget); when it grows too large mid-episode, its older turns are
   folded into a short digest by a light-model subagent. The coach never
   receives raw engine dumps, full PGNs of other games, or full profile
   history — tools return pre-digested summaries sized for conversation, never
   rows.

3. **Loop management (§8.3).** `maxSteps: 8`, per-turn tool budgets (2 engine
   checks, 1 profile read), a repeat-call breaker, an engine LRU, and a per-session
   daily credit ceiling. A well-behaved turn is 1–3 steps; the guardrails exist so
   a confused model degrades to a cheap answer, never to a spend spiral.

4. **Subagents on lower models.** The coach *delegates* instead of ingesting:

   | Subagent | Tier | Trigger | Contract |
   |----------|------|---------|----------|
   | Engine interpreter | light | inside `get_engine_analysis` | raw engine lines + coach's question → ≤80-word chess answer (prompts.md §4) |
   | Episode compactor | light | episode closes, or its budget is exceeded (§8.2) | old turns → one-move digest |
   | Analysis planner | light | before the session (worker) | engine data → CoachingPlan — the session's "prep" so the coach rarely needs live engine calls at all |
   | Progress summarizer | light | after the session (worker) | transcript → findings/focus-area updates — the coach doesn't spend expensive turns on bookkeeping it already did via `record_finding` |

   Rule of thumb encoded in code review: **if a tool result would exceed ~120 words
   or contain non-conversational data (UCI lines, JSON rows), a light subagent must
   digest it before it reaches the coach's context.**

### 7.5 Conversation threading

Human conversations interleave topics: open a branch, park it, jump to another,
come back, cross-reference. The coach gets this behavior from two pieces:

- **Prompt rules** (prompts.md §2, "Conversation threading"): the default is
  ordinary linear conversation with an empty ledger — threads exist only when a
  topic is genuinely set aside, never as routine decomposition. Then: short
  turns, one topic per message, park out loud in human language, resume
  naturally, connect threads when it teaches, let threads die honestly.
- **The thread ledger** (`update_threads` tool + `sessions.threads`): the coach's
  backstage inventory of open/parked/resolved threads, each with an optional
  hypothesis about the student's thinking and an optional board anchor so
  resuming a thread also restores the position (`show_position`).

Design properties: ledger updates travel as ordinary tool calls in the
append-only message stream → **cache-safe** (no system-prompt mutation); the
compactor carries open/parked threads across context compaction → **long-session
safe**; the ledger persists on the session row → **resume-safe**; `end_session`'s
prompt instructions require open threads to be resolved or explicitly let go →
no dangling conversations. The ledger is never rendered in the student UI.

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

- **Stable-prefix ordering, five layers** (`services/coach-context.ts`'s
  `buildEpisodeMessages`; full contract in prompts.md §2.7):
  1. static coaching instructions + tool definitions — byte-identical for every
     user and every turn;
  2. dynamic block (user profile, game, coaching plan) — identical for every
     turn *within a session*;
  3. annotated PGN — the whole game as SAN with quality symbols, static per game;
  4. other-moves-discussed summary — rebuilt from `session_move_notes`, but only
     busts its own cache entry when a note actually changes;
  5. the uncached current-position/thread-ledger block, then the current
     episode's own raw conversation (never cached — it's the one part that
     changes every turn).
  Static-first, most-stable-to-least-stable ordering throughout; never interleave
  per-turn data into a cached layer.
- **Anthropic**: set a `cache_control: {type: "ephemeral"}` breakpoint (via AI SDK
  `providerOptions.anthropic`) after each of layers 1–4 — four breakpoints, which
  is Anthropic's exact per-request maximum (see the comment in
  `buildEpisodeMessages`). Turn N then pays cache-read price for everything
  except the newest messages.
- **OpenAI**: automatic prefix caching — the same ordering rule gets the discount
  for free.
- **Do not mutate history.** `session_messages` are append-only and replayed
  verbatim; editing an old message invalidates the cache for the whole suffix.
- `llm_call_log` gains `cached_input_tokens int NOT NULL DEFAULT 0`; metering charges
  cached input at ¼ rate. The admin spend query must show cache hit-rate — a
  regression here is a cost bug.

### 8.2 Context management (episode-scoped, per-move)

Whole-session rolling compaction (the original design) is retired — replaced by
per-episode folding, scoped to one move at a time (design doc:
docs/superpowers/specs/2026-07-31-coach-context-restructure-design.md §3/§5):

- An **episode** is the contiguous run of `session_messages` sharing the
  session's current ply (`lib/episodes.ts`'s `currentEpisode`). Moving to a new
  position (`show_position`, or the student navigating the move list) closes
  the old episode.
- **On close**, the coach's own `record_move_note` call for that ply wins if
  present and succeeded; otherwise the episode's raw messages are folded
  automatically into a one-sentence note (`coach-context.ts`'s
  `closeEpisodeIfNeeded`, best-effort — a light-model failure here never aborts
  the turn). Either way the result lands in `session_move_notes`, rendered as
  one line per move in layer 4 (§8.1) on every subsequent turn.
- **Within a still-open episode**, if its own conversation exceeds a 6k-token
  budget (`EPISODE_BUDGET_TOKENS`), the same light-tier fold compacts its
  oldest ~half into a digest, seeded from any note already on this ply (a
  revisit's earlier closing note, or this same episode's own prior fold) —
  never a hardcoded blank slate. The fold point never splits a tool-call from
  its tool-result — both Anthropic and OpenAI reject that shape.
- `recall_move` exists for on-demand deeper lookup: a fresh digest of a
  specific past episode's full raw conversation, richer than the one-line
  layer-4 summary.
- Raw messages are never deleted — the UI still shows full history.
  Implemented in `services/coach-context.ts` and `services/session-context.ts`
  (the underlying budget/cooldown/fold primitives, reused from the original
  whole-session design), unit-testable pure functions over messages + budget.

### 8.3 Loop management (agent-turn guardrails)

`streamText` is configured so a confused model cannot burn money:

- `maxSteps: 8` per user turn (a normal turn uses 1–3).
- **Per-turn tool budget** enforced in tool wrappers: max 2 `get_engine_analysis`
  calls, 1 `get_user_profile` call, and 3 `recall_move` calls per turn; over
  budget → the tool returns `{error: "budget_exhausted — answer with what you
  have"}` instead of executing.
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

Visual/UX contract: `docs/design.md` (tokens, breakpoints, per-screen layouts,
component inventory). This section covers code structure only.

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
