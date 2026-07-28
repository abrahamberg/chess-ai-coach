# Chess AI Coach — Functional Specification

**Version:** 1.0 · **Date:** 2026-07-28 · **Status:** Approved for implementation

---

## 1. Vision

A **personal chess coach**, not another analysis site. Lichess and chess.com already show
you engine bars and "best move" arrows. This product does what a human coach does:

- Walks through **your** games with you, conversationally, over a board.
- Asks **Socratic questions** ("Why did you play this? What did you calculate? What did
  you reject?") instead of dumping engine lines.
- **Remembers you across sessions** — your recurring mistakes, your improvements, your
  current focus areas — and uses that memory to make every session build on the last.
- Tracks growth over time and shows it.

The engine (Stockfish) runs behind the scenes and informs the coach; raw evals are
**not** the product surface. The coach decides what to reveal and when.

### 1.1 The differentiator (non-negotiable)

The coach is a **stateful agent that knows the user**. Every design decision must serve
this. If a feature could exist identically on lichess.org/analysis, it is not our core.

## 2. Target users

Chess.com rating **500–2000** (Lichess roughly 800–2200). These players know the rules
and basic techniques. Their bottlenecks are:

| Band | Chess.com rating | Typical bottlenecks |
|------|-----------------|---------------------|
| `novice` | 500–900 | Hanging pieces, one-move threats, no blunder-check habit |
| `improving` | 900–1300 | Missed tactics, no opening plan, poor piece coordination |
| `club` | 1300–1700 | Calculation depth/accuracy, pawn-structure understanding, endgame technique |
| `advanced` | 1700–2000 | Decision-making quality, evaluating unforced positions, narrow-repertoire depth, prophylaxis |

The coach calibrates vocabulary, question difficulty, and how much it reveals per band
(see `docs/prompts.md` §2.3). Users outside 500–2000 may use the product; the coach
clamps them to the nearest band.

## 3. Core user journey

1. **Sign in** via Google or Lichess (oauth2-proxy).
2. **Onboard** (first login only): pick rating band or link a Lichess/chess.com username
   to auto-detect; state self-assessed weaknesses (optional, free text).
3. **Import a game**: paste PGN, upload a `.pgn` file, or (Lichess users) pick from
   their recent games via the Lichess API.
4. **Analysis runs in the background** (~30–90 s): engine evaluates every position, the
   analysis-planner LLM produces a private *coaching plan* (critical moments, themes,
   questions to ask). The user sees a progress indicator, never raw output.
5. **Coaching session**: split view — board left, chat right. The coach opens by
   connecting this game to the user's history ("Last time we worked on your habit of
   pushing pawns in front of your king — let's see how you did here"). It replays the
   game, stopping at critical moments, asking questions, letting the user try moves on
   the board, and revealing lines only after the user has committed to an answer.
6. **Session close**: coach summarizes what was learned, records findings to the user's
   profile, updates focus areas, optionally assigns homework ("Before your next game,
   do a blunder-check on every move — we'll review whether it helped").
7. **Dashboard**: mistake trends over time, active focus areas, session history,
   per-category improvement graphs.

## 4. Functional requirements

### 4.1 Game import (F1)

- F1.1 Accept PGN via paste or file upload (max 1 game per import in v1; multi-game PGN
  → user picks one).
- F1.2 Validate PGN (`chess.js`); reject illegal/corrupt with a specific error message.
- F1.3 Auto-detect which side the user played by matching PGN headers (`White`/`Black`)
  against the user's linked usernames; otherwise ask.
- F1.4 Lichess-authenticated users can browse and import their recent games via the
  Lichess API (`GET /api/games/user/{username}`).
- F1.5 Store the original PGN verbatim plus parsed metadata (players, result, date,
  time control, ECO code when derivable).

### 4.2 Analysis pipeline (F2) — hidden from user

- F2.1 Engine service evaluates every position after each ply: depth 16 minimum,
  MultiPV 2. Results cached per game.
- F2.2 Classify each user move by centipawn loss (from the mover's perspective, capped
  at ±1000cp): `good` <50, `inaccuracy` 50–99, `mistake` 100–299, `blunder` ≥300.
- F2.3 Detect **critical moments**: (a) every mistake/blunder by the user, (b) missed
  wins/tactics ≥300cp the user didn't play, (c) key turning points (eval crosses ±150cp),
  (d) instructive moments the planner selects even without eval swing (e.g., a plan
  decision point). Cap: 8 moments per game (planner prioritizes).
- F2.4 The analysis-planner LLM (one call) receives engine data + user profile and
  outputs a JSON coaching plan (schema in `architecture.md` §6.3).
- F2.5 Pipeline is an async job with states `queued → engine_running → planning → ready
  | failed`; the client polls or receives updates via SSE.

### 4.3 Coaching session (F3) — the product core

- F3.1 The coach is a **tool-calling agent** (Vercel AI SDK `streamText` loop, see
  `architecture.md` §7). It drives the board, queries the engine, and reads/writes the
  user profile via tools — the model decides when.
- F3.2 Split UI: interactive board (react-chessboard) + streaming chat. When the coach
  calls `show_position`, the board animates there; `annotate_board` draws arrows/
  highlights.
- F3.3 The user can make moves on the board to answer "what would you play?"; the move
  is sent to the agent as a structured message (`{type:"board_move", san, fen}`).
- F3.4 Socratic default: at each critical moment the coach asks before it tells. It
  reveals the engine's view only after the user commits to an answer or asks to see it.
- F3.5 The coach's system prompt includes the user's profile: focus areas, recent
  findings, band, session count. Cross-session continuity is a hard requirement.
- F3.6 Sessions are resumable: full message history persists; reopening a session
  restores board state and conversation.
- F3.7 One active session per game; re-analyzing a game starts a new session but the
  coach can reference the old one.

### 4.4 Progress tracking (F4)

- F4.1 During/after a session the agent records **findings**: `{category, severity,
  ply, description}` using the fixed taxonomy below.
- F4.2 **Mistake taxonomy** (closed enum — prompts and DB share it):
  `hanging_piece`, `missed_tactic`, `allowed_tactic`, `calculation_error`,
  `premature_action`, `passive_play`, `pawn_structure`, `king_safety`,
  `piece_activity`, `endgame_technique`, `opening_knowledge`, `no_plan`,
  `time_management`.
- F4.3 **Focus areas**: at most 3 `active` per user at a time. The progress-summarizer
  LLM proposes creating/updating them at session end; state machine:
  `active → improving → resolved` (or back to `active` on regression). Evidence counter
  and last-seen date per area.
- F4.4 Dashboard: findings-per-category over time (last 20 games), active focus areas
  with trend, session list, streak/consistency indicator.
- F4.5 The coach references focus-area trends in conversation ("Third game in a row with
  no hanging pieces — that focus area is close to done").

### 4.5 Auth & identity (F5)

- F5.1 oauth2-proxy fronts the app; providers: **Google** and **Lichess** (chess.com
  has no public OAuth — its users sign in with Google and paste PGNs).
- F5.2 API trusts only `X-Auth-Request-Email` / `X-Auth-Request-User` headers from the
  in-cluster proxy; direct external access to the API is blocked by NetworkPolicy.
- F5.3 First login creates the user row; users may link a Lichess and/or chess.com
  username to their account for side-detection and (Lichess) game import.
- F5.4 Local development uses a header-injecting stub so the API code path is identical.

### 4.6 LLM access: BYOK + credits (F6)

- F6.1 Users may store their own **Anthropic** and/or **OpenAI** API key (encrypted
  at rest, AES-256-GCM, never returned to the client after save, deletable).
- F6.2 Users without a key spend **credits** from a ledger. Metering: 1 credit =
  1,000 LLM tokens (input+output combined) on the standard model tier; premium-model
  sessions meter at 4× (tiers in `architecture.md` §8.4). A typical full session ≈
  30–60 credits.
- F6.3 Credit packs via Stripe Checkout (one-time payments): 300 / 1,000 / 3,000
  credits. Ledger is append-only; balance = SUM(delta). Stripe webhook
  (`checkout.session.completed`) credits the ledger idempotently by event id.
- F6.4 Hard stop when balance would go negative mid-session: coach wraps up gracefully
  and the session is preserved for resume after top-up. BYOK users are never metered.
- F6.5 New users get 100 free credits (enough for ~2 sessions) to experience the
  product before choosing BYOK or purchase.

### 4.7 Rating-band calibration (F7)

- F7.1 Band (from §2) is stored on the user and injected into every prompt.
- F7.2 Calibration affects: vocabulary, line length shown (novice: ≤2 plies; advanced:
  full variations), question difficulty, number of critical moments emphasized, and
  homework type. Exact calibration text lives in `docs/prompts.md` §2.3.
- F7.3 Band can be changed by the user; the coach may *suggest* a change after
  consistent evidence but never changes it unilaterally.

## 5. Non-functional requirements

- **N1** Stack: Node.js 22 LTS, TypeScript strict everywhere, React 18 + Vite,
  Fastify 5, PostgreSQL 16, Vercel AI SDK (latest stable) for the agent loop.
- **N2** Deploy: Kubernetes via a single Helm umbrella chart (`deploy/helm/`);
  images built per service; works on any conformant cluster (target: k3s and GKE).
- **N3** Coach first-token latency < 3 s; board tool actions render < 500 ms after the
  tool call streams; analysis pipeline completes < 90 s for a 60-move game.
- **N4** All LLM calls go through one internal gateway module (provider adapter +
  metering + logging). No direct SDK calls elsewhere.
- **N5** Engine service is stateless and horizontally scalable; analysis jobs are
  queued (PostgreSQL-backed queue, `graphile-worker`) — no Redis in v1.
- **N6** Tests: Vitest; every module has unit tests; API routes have integration tests
  against a real Postgres (Testcontainers); target ≥80% line coverage on `apps/api`
  and `packages/*`.
- **N7** Secrets only via K8s Secrets/env vars; user LLM keys encrypted with a
  server-side master key; no secrets in logs (redaction middleware).
- **N8** Costs visible: every LLM call logs tokens (incl. cached input tokens) +
  metered credits; admin can query spend and cache hit-rate per user/day.
- **N9** Cost discipline is architectural: prompt caching with stable prefixes,
  conversation-context budget with rolling compaction, per-turn tool budgets and
  loop breakers, and light-tier models for every non-conversational LLM job
  (`architecture.md` §8.1–8.4).
- **N10** Layering: agent tools and routes never contain SQL; all data access goes
  tool/route → service (invariants) → repository (only place with queries).

## 6. Out of scope (v1)

- Playing against the coach / sparring mode.
- Calculation-training mode with curated studies (v2 — prompt already drafted).
- Opening-repertoire builder (v2).
- Mobile apps (responsive web only).
- chess.com automatic game import (no public API for arbitrary fetch → user pastes).
- Multi-language coaching (English only).
- Voice input/output.

## 7. Success criteria

- S1 A user can go from pasted PGN to an interactive coached session in under 2 minutes.
- S2 After 3 sessions, the coach demonstrably references earlier sessions' findings
  (verifiable in conversation logs).
- S3 Findings and focus areas populate automatically — no manual tagging by the user.
- S4 A fresh cluster deploys end-to-end with `helm install` + a values file.
- S5 A BYOK user incurs zero credit spend; a credits user sees an accurate balance
  after every session.
