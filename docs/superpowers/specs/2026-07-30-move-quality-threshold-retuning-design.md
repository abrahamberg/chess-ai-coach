# Move quality threshold retuning (win%-based ladder, true multi-PV miss, hung-piece signal)

**Date:** 2026-07-30 · **Status:** approved, ready for implementation plan

## Context

The move-quality-badges feature (2026-07-29) shipped an 8-tier classification
(`brilliant/best/good/interesting/dubious/mistake/miss/blunder`) driven by
flat centipawn-loss (`cpLoss`) bands. During live browser verification,
Daniel flagged two problems and explicitly deferred both to a follow-up spec
("Finish this plan, tune thresholds next"):

1. **Too dense** — "it seems that the logic is too tight... eveything is
   marked like that." Flat cp bands don't account for how decided a position
   already is: losing 100cp when already +8 gets flagged the same as losing
   100cp near equal, even though the first barely changes anyone's practical
   winning chances.
2. **Not enough signal** — "probably we need to have a little bit more that
   engine feedback... if it was a sacrifce, or left the pice undefended."
   (Sacrifice detection already existed by the time this spec was written —
   `isSacrifice` in `classify.ts`, powering the `brilliant` tier. What's
   still missing is an undefended-piece / hung-piece signal.)

This spec covers: (a) replacing the flat-cp ladder with a win-probability
("Expected Points", EP) based ladder, (b) upgrading the `miss` tier from its
current cheap approximation to true multi-PV detection, and (c) adding a
`hangsPiece` signal. It does **not** touch `brilliant`'s sacrifice detection
(already correct) or the `turning_point` critical-moment rule (a different,
cp-based concept, out of scope here).

## Decisions made during brainstorming

- **Ladder source:** Daniel provided chess.com's own published algorithm
  (Expected-Points-lost bands: Best 0.00, Excellent 0.00–0.02, Good
  0.02–0.05, Inaccuracy 0.05–0.10, Mistake 0.10–0.20, Blunder >0.20) as a
  starting reference, then asked how Lichess's open-source classifier
  compares. Lichess uses the same cp→win% conversion but a coarser 3-band
  scheme (~0.10/0.20/0.30 EP-loss for inaccuracy/mistake/blunder, nothing
  flagged below that). **Daniel chose to follow Lichess's coarser bands**
  over chess.com's tighter ones — directly addressing the "too tight"
  complaint by roughly doubling every cutoff versus the chess.com reference.
- **Miss semantics:** switch from the cheap "was already winning big and
  gave a lot back" approximation to true multi-PV detection (best-vs-
  second-best line gap), matching chess.com's real definition ("opponent
  blundered, you didn't take it"). Initially flagged as a scope/cost
  increase (enabling multi-PV on full-game analysis), but investigation
  found the engine service already defaults to `MultiPV=2`
  (`services/engine/src/uci.ts:9`) and `analyzeGameViaEngine` already
  receives 2 lines per position today — `classify.ts` just never reads
  `lines[1]`. **Zero additional engine cost.**
- **`hangsPiece` scope:** expose as a new `ClassifiedMove`/`ClassifiedMoveDto`
  boolean field for future coaching use (the deferred Explain-flow spec),
  **not** wired into `qualityFor` — EP-loss already drives tier severity
  correctly; this is purely a "what happened" signal for later prose
  generation, not a second severity input.

## Data model & classification changes

**`packages/chess-analysis/src/classify.ts`**

New win%-conversion function (standard logistic cp→win-probability curve,
the same one used across chess.com/Lichess-adjacent tooling):

```ts
/** Converts a mover-perspective centipawn score to that mover's expected
 * points (0–1), via the standard logistic win-probability curve. Symmetric
 * around cp=0 (0.5) and monotonic; mate scores arrive pre-clamped to
 * +-MATE_CP by whitePerspectiveCp/mateToCp, so they saturate near 0/1
 * rather than exploding. */
function expectedPoints(cp: number): number {
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}
```

New constants (replacing `INTERESTING_THRESHOLD_CP`, `DUBIOUS_THRESHOLD_CP`,
`MISTAKE_THRESHOLD_CP`, `BLUNDER_THRESHOLD_CP`, `WINNING_POSITION_CP`, all
removed):

```ts
const INTERESTING_EP = 0.05;
const DUBIOUS_EP = 0.10;
const MISTAKE_EP = 0.20;
const BLUNDER_EP = 0.30;
const MISS_GAP_CP = 300;
```

`classifyMove` computes `epLoss` alongside the existing `cpLoss`, and the new
`isMiss` signal from the pre-move eval's top two lines:

```ts
const epLoss = clamp(expectedPoints(bestCp) - expectedPoints(playedCp), 0, 1);

const bestMoveSan = evalBefore?.lines[0]?.moveSan;
const secondLine = evalBefore && evalBefore.lines.length >= 2 ? evalBefore.lines[1] : undefined;
const secondBestCp = secondLine ? toMoverPerspective(whitePerspectiveCp(secondLine), mover) : undefined;
const isMiss =
  !deliveredMate &&
  secondBestCp !== undefined &&
  bestMoveSan !== undefined &&
  position.moveSan !== bestMoveSan &&
  bestCp - secondBestCp >= MISS_GAP_CP;

const hangs = fenBefore !== undefined && position.moveSan !== null && hangsPiece(fenBefore, position.moveSan);
```

The `!deliveredMate` guard matters: without it, a move that delivers mate via
a different (but equally winning) line than the engine's exact top choice
could spuriously trigger `isMiss` — mate scores collapse to `MATE_CP` in
`lines[0]` vs a much lower `lines[1]`, which would otherwise blow past
`MISS_GAP_CP` even though delivering mate is definitionally the best
possible outcome.

`qualityFor` gains `epLoss` and `isMiss`, drops `bestCpBeforeMoverPerspective`:

```ts
export function qualityFor(cpLoss: number, epLoss: number, isSacrifice = false, isMiss = false): MoveQuality {
  if (isMiss) return 'miss';
  if (epLoss >= BLUNDER_EP) return 'blunder';
  if (epLoss >= MISTAKE_EP) return 'mistake';
  if (epLoss >= DUBIOUS_EP) return 'dubious';
  if (epLoss >= INTERESTING_EP) return 'interesting';
  if (isSacrifice) return 'brilliant';
  return cpLoss === 0 ? 'best' : 'good';
}
```

`isMiss` is checked before the ladder and before `brilliant`, mirroring
chess.com's own stated precedence (Brilliant → Great → Miss applied as
overrides on top of the base ladder) — a move can be tagged `miss` even when
its own `epLoss` looks fine, which is the whole point: EP saturates near the
extremes, so "you're already crushing either way, but you skipped a mate"
would otherwise wash out to ~0 loss and hide the miss entirely. `cpLoss ===
0` stays the exact (non-EP) gate for `best`, unchanged — avoids any
floating-point-equality concerns and matches today's behavior exactly for
the one case that must never drift.

Final ladder (all bounds in EP-loss, i.e. win-probability points lost):

| Tier | Band | Notes |
|---|---|---|
| `brilliant` | sacrifice + `epLoss < INTERESTING_EP` | unchanged detection (`isSacrifice`), only the gating threshold moved from cp to EP |
| `best` | `cpLoss === 0` | unchanged |
| `good` | `0 < epLoss < 0.05` | no badge, unchanged |
| `interesting` | `0.05 ≤ epLoss < 0.10` | |
| `dubious` | `0.10 ≤ epLoss < 0.20` | |
| `mistake` | `0.20 ≤ epLoss < 0.30` | |
| `blunder` | `epLoss ≥ 0.30` | |
| `miss` | true multi-PV gap ≥ 300cp, not the best move, no mate delivered | overrides the ladder result |

New exported heuristic, alongside the existing `isSacrifice`:

```ts
/** Best-effort "left a piece hanging" signal: true when the piece that just
 * moved lands on a square the opponent attacks with nothing of the mover's
 * own defending it. Simpler than isSacrifice — no equal-or-lesser-attacker
 * comparison, no capture exclusion (a bad recapture that hangs the
 * recapturing piece still counts) — and, like isSacrifice, only looks one
 * ply deep at the moved piece itself, not the whole board or later plies. */
export function hangsPiece(fenBefore: string, moveSan: string): boolean {
  const chess = new Chess(fenBefore);
  let move;
  try {
    move = chess.move(moveSan);
  } catch {
    return false;
  }
  if (!move || move.piece === 'p' || move.piece === 'k') return false;

  const opponentColor = move.color === 'w' ? 'b' : 'w';
  if (!chess.isAttacked(move.to, opponentColor)) return false;
  return !chess.isAttacked(move.to, move.color);
}
```

`ClassifiedMove` (and the returned object in `classifyMove`) gains
`hangsPiece: boolean`. Not read by `qualityFor` or by `critical-moments.ts`
— purely exposed data for a future spec.

**`packages/shared/src/analysis.ts`**
- `ClassifiedMoveSchema` gains `hangsPiece: z.boolean()`.

**`packages/chess-analysis/src/critical-moments.ts`**
- Remove `MISSED_CHANCE_GAP_CP`, `missedChanceMoments`, and `'missed_chance'`
  from `CandidateMomentKind` and `KIND_PRIORITY`. This rule computed the
  exact same signal (`best`-vs-`secondBest` line gap, same 300cp magnitude)
  but only fired on moves `isSoundQuality` already excludes `miss` from —
  once `classify.ts` claims this signal for the `miss` tier itself, every
  move `missedChanceMoments` would have flagged is already tagged `miss` and
  filtered out by `isSoundQuality` before reaching it. Dead code, removed
  rather than left in place.
- `findCandidateMoments` drops the `addAll(byPly, missedChanceMoments(...))`
  call and the now-unused `evals` usage it required (still needed for
  `turningPointMoments`, which is unaffected and stays as-is).
- **Not changed:** `packages/shared/src/coaching-plan.ts`'s
  `MomentKindSchema` (still includes `'missed_chance'`) and the prompt
  template in `packages/prompts/src/analysis-planner.ts` (still describes
  `missed_chance` as an available kind). Those describe the coaching-plan
  LLM's *own* output vocabulary — per the existing rule-d comment in
  `critical-moments.ts`, the LLM can independently judge a moment as a
  missed chance from general chess reasoning even without a candidate
  moment prompting it (this is explicitly "the LLM's job, not this pure
  function's"). Removing our internal candidate-detection doesn't remove
  the LLM's ability to use that label.
- `docs/plan.md`'s description of the internal `CandidateMoment` type and
  the missed_chance rule needs updating to match (prose-only, not a schema).

**`packages/chess-analysis/src/critical-moments.test.ts`**
- Delete the `missed_chance`-specific test cases (gap thresholds, quality
  gating, perspective, opponent-move exclusion, dedup-priority test's
  `missed_chance` leg).

## Existing games

`classifiedMoves` are computed once during the `analyze-game` job and
persisted (`analysesRepo.storeClassifiedMoves`) — never recomputed on read.
Already-analyzed games keep their current tier assignments (including the
old approximate `miss` semantics) until re-analyzed. No backfill/migration —
consistent with how the original `best`/`miss` tier introduction was
handled.

## Testing plan

- `classify.test.ts`:
  - `expectedPoints` sanity checks: `cp=0 → 0.5`, monotonic increasing,
    symmetric (`expectedPoints(-cp) === 1 - expectedPoints(cp)`).
  - Rewrite the tier-threshold table for EP-based bands (pick concrete cp
    pairs that land in each band via `expectedPoints`, not raw cp
    boundaries).
  - `isMiss` cases: gap ≥300cp + not-best-move → `miss` regardless of own
    `epLoss`; gap present but move IS the best move → not `miss`;
    `evalBefore` with only 1 line → not `miss` (no false positive from
    missing multi-PV data); `deliveredMate` → never `miss` even if
    `lines[1]` is far below `lines[0]`.
  - `hangsPiece` cases: piece lands on attacked+undefended square → true;
    defended → false; pawn/king moves excluded; a capture that leaves the
    capturing piece hanging → true (unlike `isSacrifice`, captures aren't
    excluded here).
- `critical-moments.test.ts`: delete removed `missed_chance` cases; keep the
  `user_mistake`-includes-`miss` regression guard (unaffected by this spec).
- `schemas.test.ts`: `hangsPiece` field round-trips through
  `ClassifiedMoveSchema`.
- **Live verification**: re-run analysis on a real imported game, eyeball
  badge density on both `MoveExplorer` (desktop) and `MoveStrip` (mobile)
  against the old density — this is a tuning change, and jsdom assertions
  can't judge "does this feel right," only that the arithmetic is
  internally consistent.

## Non-goals (explicitly deferred to future specs)

- Using `hangsPiece` in actual coach output/UI (the Explain-flow spec).
- `turning_point`'s cp-based (not EP-based) threshold — a different concept
  (eval-sign crossing), not part of the density complaint this spec fixes.
- Explain/Next review flow, evaluation graph, share/export, chat avatar
  facelift — all still queued from the original move-quality-badges spec's
  non-goals list, untouched here.
