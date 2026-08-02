# Chess AI Coach — Remaining work

The initial build (Phases 0–9: monorepo scaffold through Stripe credits and
Helm/CI deploy) is complete — see `git log` for that history and
`docs/architecture.md` for how the system actually fits together. This file
now tracks only genuinely open work.

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
