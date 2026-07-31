# Coach context restructure — design

Status: approved, ready for implementation planning.

## Problem

The coach agent's live turn (`coach-agent.ts`'s `startTurn`) replays the **entire raw
`session_messages` history**, uncompacted, on every turn. There's a fully-built,
unit-tested rolling-compaction module (`services/session-context.ts`,
`sessions.contextDigest`/`digestThroughMessageId`) documented in `architecture.md`
§8.2 — but nothing in `coach-agent.ts` ever calls it. As a session moves through many
positions, the transcript accumulates discussion of every move the coach and student
have looked at, flattened into one linear history the model must disambiguate itself.
In practice this causes the model to confuse or hallucinate details about positions
it isn't currently discussing.

There is also no server-side concept of "what move is the student looking at right
now" beyond the coach's own `show_position` calls: student-driven navigation (the
move-list sidebar, `MoveStrip`/`MoveExplorer`) is purely client-local, and a jump back
to an earlier position while replying is only visible to the model as text embedded
in the user's message (`[position_context] Back at move 22...`) — it never states
what move was being discussed *before* the jump, so the coach has to infer that from
scrollback.

This redesign replaces blind full-transcript replay with context assembled from
structured, position-scoped state, while leaving what the student sees in the UI
completely unchanged.

## Scope decisions (from brainstorming)

- **Board piece-dragging is out of scope.** `CoachBoard`'s peek/local-exploration
  drags (`onLocalMove`) never change "current move" — that's exploring a hypothetical
  on top of whatever position is loaded. Only two things change the current move:
  the coach calling `show_position`, and the student navigating via the move-list
  sidebar and then sending a message (`anchorHere`).
- **The student-facing chat is untouched.** `getSessionDetail` keeps reading the full
  linear `session_messages` history exactly as today (still minus backstage
  `update_threads` parts). This redesign only changes what `startTurn` builds for
  `streamText` — the model's working context — never what the UI renders.
- **Revisiting a move starts a fresh episode**, not merged with an earlier visit to
  the same ply. The earlier visit's detail lives in its note (see below), not in raw
  replay — this is what actually bounds the size of the uncached "current" block
  regardless of how much back-and-forth a session has.
- **`session-context.ts`'s whole-transcript compaction is retired in its current
  form.** Its `compact()` function is reused, retargeted from "fold the oldest half
  of the whole transcript" to "fold one closed episode" — one summarizer, used at a
  finer grain, not two competing mechanisms.
- **`sessions.contextDigest`/`digestThroughMessageId` are dropped.** What they were
  for is replaced by `session_move_notes` (below).

## 1. Episode tagging

Add a nullable `ply int` column to `session_messages`. Every message is tagged with
`sessions.currentPly` **at the moment it's written**:

- User/assistant text and tool-calls persisted in `onFinish` are tagged with whatever
  `currentPly` is at that point — still the *old* ply if the coach is mid-message
  deciding to leave it.
- The `show_position` tool-result, inserted by `applyClientToolResult`, is tagged
  with the *new* ply — `updateCurrentPly` already runs before that insert, so this
  falls out with no special-casing.

An **episode** is a contiguous run of messages sharing the same `ply`, found by
scanning backward from the end of the already-fetched transcript while
`ply === currentPly` (an in-memory walk, not a SQL grouping). The current turn's
`priorMessages` for `streamText` becomes *this episode's messages only*, replacing
`ALL session_messages`.

`check_position` (silent, never moves the board) cannot fracture an episode — it
never changes `currentPly`.

## 2. Student-driven jumps become a real server-side event

The API parses the `[position_context] Back at move N (color), after SAN: ...`
sentinel on incoming user messages (today purely a client-side hint) and updates
`sessions.currentPly` from it — exactly like `show_position` already does, and with
the same "never trust the client" principle as `withAuthoritativeFen`: the claimed
ply is re-validated against `getPositionAtPly`, not taken on faith. This is the one
new piece of server-side parsing this design adds to the turn-input path.

"Previous move" is never persisted as its own column — it's just the `ply` of the
last message before the new episode started, read off the same tagged transcript at
context-assembly time. No redundant source of truth.

## 3. Per-move notes (write path)

New table, session-scoped — deliberately distinct from the durable, cross-session
`findings` table; this is in-session bookkeeping, not a student pattern tracked
across months:

```sql
session_move_notes (
  id          uuid primary key,
  session_id  uuid not null references sessions(id),
  ply         int not null,
  note        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, ply)
)
```

Upsert semantics keyed on `(session_id, ply)` — whichever write happens last for a
ply wins, matching `update_threads`'s existing full-replace philosophy. This single
row also serves as the rolling in-progress digest for a still-open episode (see
"Long-running episode safety net" below), not just the closed-episode summary.

Two ways a note gets written once an episode closes:

- **Coach-authored (preferred):** new tool `record_move_note(ply, note)` —
  discretionary, same pattern as `record_finding` ("whenever something's worth
  remembering"), not mandatory every move. The existing session-flow instruction
  ("before you leave a moment, make sure you've told them the best move and why") is
  extended to also prompt calling this.
- **Automatic fallback:** if the coach leaves an episode without calling it, a
  light-tier call summarizes that episode's raw messages into a note — this is
  `session-context.ts`'s `compact()`, reused, not reimplemented.

The objective move-quality tag (blunder/good/best/...) is never written by the coach
— it's already in `analyses.classifiedMoves`, free (see layer 3 in §5).

### Long-running episode safety net

A single episode could in principle run long (many turns on one move). The existing
budget/cooldown logic in `session-context.ts`'s `prepareContext` (token-budget check,
`COMPACTION_COOLDOWN_TURNS`) is reused, scoped to *this episode's* messages instead of
the whole session, folding the older part of an still-open episode into
`session_move_notes`' row for that ply and keeping only the tail raw. When the
episode later closes for real, the coach's `record_move_note` call (or the auto
fallback) simply overwrites this in-progress row.

## 4. Recall tool (read path)

The other-moves-summary layer (§5, layer 4) injects the one-line note for every
previously-discussed ply on every turn — cheap, always present. For cases where
that's not enough, a new tool `recall_move(ply)` pulls the fuller raw sub-conversation
for that specific episode from the tagged `session_messages` rows (`WHERE ply = ?`,
excluding the currently-open episode which is already in context) — same shape as
`get_user_profile`: on-demand, subject to the existing per-turn tool-budget guard
(`TOOL_BUDGETS` in `coach-tools.ts`). A ply with no note and no messages (never
visited) returns an explicit "nothing recorded for that move" result, not an empty or
ambiguous one.

`ply` is validated against `getPositionAtPly` before querying — same validation used
everywhere else a ply crosses a trust boundary.

## 5. Context assembly (replaces `buildCacheableMessages`)

Five layers, stable-prefix-first, each with its own cache breakpoint so a layer only
busts the cache when *its own* source actually changes:

1. **System (`staticPart`)** — unchanged. Tool definitions ride along in this same
   fixed prefix already (provider-automatic); no change needed.
2. **Dynamic (`dynamicPart`)** — unchanged: student profile, game meta, coaching plan.
3. **NEW — annotated PGN, own breakpoint.** Static per game, built once from
   `parsePgn` + `analyses.classifiedMoves`, identical every turn of the session.
   Compact form: full move list in SAN with quality symbols inline
   (`18.Nf3! Bg4?!`); only non-`good`/`best` moves (`mistake`/`blunder`/`miss`/
   `dubious`) get extra detail (cpLoss, best line) inline, to keep an 80-ply game
   from bloating the block.
4. **NEW — other-moves summary, own breakpoint.** Rebuilt each turn from
   `session_move_notes WHERE ply != currentPly` (cheap query) — one line per
   discussed ply, e.g. "Move 22 (blunder): missed Rxd5, discussed why, assigned as
   homework." Only actually changes, and only busts its own cache entry, when a note
   for a non-current ply is added or updated — infrequent.
5. **Current-move block — uncached.** "You are now at move 22 (white), FEN: `...`.
   You jumped here from move 18." (from §1/§2) + this episode's raw messages (§1,
   §3's safety net) + `yourThreads()`.

## 6. Migration and backfill

- New migration: `session_messages.ply int null`; `session_move_notes` table (§3);
  drop `sessions.context_digest` / `digest_through_message_id`.
- Existing sessions mid-flight at deploy time have no historical record of what was
  "current" at each past message. Given this is pre-launch/low-volume, backfill
  crudely: tag all of a session's existing messages with that session's
  `currentPly` at migration time. Worst case, one old session's first post-migration
  turn replays more than strictly necessary; it self-corrects from the next episode
  boundary onward. Not worth a more precise reconstruction.

## Key files touched

- `apps/api/src/services/coach-agent.ts` — `startTurn` (episode-scoped
  `priorMessages`, `[position_context]` parsing, five-layer message assembly),
  `applyClientToolResult` (ply tagging on insert).
- `apps/api/src/services/session-context.ts` — retarget `compact()` to per-episode
  folding; `prepareContext`'s budget/cooldown reused for the long-episode safety net.
- `apps/api/src/services/coach-tools.ts` — new `record_move_note`, `recall_move`
  tools (`TOOL_BUDGETS` entry for `recall_move`).
- `apps/api/src/services/game-positions.ts` — reused as-is for ply validation.
- New: `apps/api/src/services/move-notes.ts` (or similar) — `session_move_notes`
  repository + annotated-PGN and other-moves-summary renderers.
- `packages/prompts/src/coach-system.ts` — new render functions for the annotated-PGN
  and other-moves-summary blocks, current-move-block template (jump sentence).
- `apps/api/src/db/schema.ts`, new migration file — `SessionMessagesTable.ply`,
  `SessionMoveNotesTable`, drop the two `contextDigest` columns.
- `apps/api/src/routes/sessions.ts` — parse `[position_context]` on incoming message
  content before persisting.
- No frontend changes required — `anchorHere`/`encodePositionContext` already produce
  the sentinel this design consumes; `getSessionDetail`/chat UI are unchanged by
  design.

## Testing

- Unit: episode-scan-from-tagged-messages (contiguous run, revisit-starts-fresh
  case), annotated-PGN renderer, other-moves-summary renderer, `[position_context]`
  parse + `getPositionAtPly` validation, `record_move_note`/`recall_move` tool
  handlers (including the "nothing recorded" case and ply-out-of-range rejection).
- Unit: `session-context.ts`'s reused `compact()`/`prepareContext` against a single
  episode's messages instead of a whole-session list.
- Integration (`coach-agent.test.ts`): a full jump sequence — discuss move 18, coach
  moves to 22, student jumps back to 18 via the sidebar — verifying the request built
  for the mock model contains the five layers, the current-move block states the
  jump, and move 22's raw detour is *not* replayed once it's no longer current.
- Integration: session resume after restart reconstructs the same layering purely
  from DB state (no in-memory dependency).
