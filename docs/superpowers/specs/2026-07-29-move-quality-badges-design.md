# Move quality badges (Best + Miss tiers, icon redesign)

**Date:** 2026-07-29 · **Status:** approved, ready for implementation plan

## Context

Daniel wants the session screen's move list to feel more like chess.com's
Game Review (referenced: `chess.com/analysis/game/live/172247832668/review`)
— specifically: a star for the best move, a "Miss" category that doesn't
exist yet, and a cleaner icon-badge treatment for move quality generally.

The full request also included an Explain/Next review flow, a PNG/PGN
share/export feature, an evaluation graph, and a chat-avatar facelift. Those
are out of scope for this spec — they're independent pieces of work and will
get their own design passes. **This spec covers only the move-quality badge
redesign and the new Best/Miss tiers.**

We already have a working quality-color system in `MoveExplorer` (6 tiers:
brilliant/good/interesting/dubious/mistake/blunder, colored SAN text + NAG
suffix like `Nf3?!`). This spec extends it to 8 tiers with a proper icon
badge, matching chess.com's visual language, and threads it into the mobile
`MoveStrip` too (which currently has zero quality styling).

## Decisions made during brainstorming

- **Badge style:** full icon badges (colored circle + glyph) before every
  non-neutral move's SAN — chess.com-literal. Validated via visual companion
  mockups (three styles shown: full badges / quiet dots / hybrid-icons-only-
  for-headline-moments). Full badges was the clear pick.
- **Scope:** both desktop (`MoveExplorer`) and mobile/tablet (`MoveStrip`),
  not desktop-only.
- **Miss detection:** the cheap heuristic (reuse cpLoss + pre-move eval, zero
  extra engine cost), not true multi-PV "second-best line" detection. See
  below for why, and what's explicitly *not* being fixed here.
- **Icons are plain Unicode glyphs in colored circles**, not an icon library
  — the app has no icon dependency today (uses ♞, ◀▶, ⋯, ↩︎ etc. natively) and
  8 short glyphs don't justify adding one.
- **Final 8-tier palette** (validated via a second mockup):

  | Tier | Glyph | Color | Meaning |
  |------|-------|-------|---------|
  | `brilliant` | `!!` | `#2f7dc4` (existing) | sacrifice the engine loves — rare |
  | `best` | `★` | `#5b9c6a` (**new**) | the exact top engine choice |
  | `good` | *(none)* | — | close to best — no badge, unchanged |
  | `interesting` | `!?` | `#2f9e8f` (existing) | a bit loose but not wrong |
  | `dubious` | `?!` | `#c9a227` (existing) | clearly gives something back |
  | `mistake` | `?` | `#d9622b` (existing) | a real error |
  | `miss` | `✕` | `#a8477a` (**new**) | was winning big, gave it back |
  | `blunder` | `??` | `#c0392b` (existing) | a serious error, not from a winning position |

## Data model & classification changes

**`packages/shared/src/analysis.ts`**
- `MOVE_QUALITIES` grows to `['brilliant', 'best', 'good', 'interesting', 'dubious', 'mistake', 'miss', 'blunder']`.
- `MOVE_QUALITY_SYMBOLS` gains `best: '★'` and `miss: '✕'`.

**`apps/web/src/styles/tokens.css`**
- Two new tokens, `--quality-best` and `--quality-miss`, alongside the
  existing five, for both light and dark themes (same hex — these aren't
  theme-sensitive, matching how the existing five are defined).

**`packages/chess-analysis/src/classify.ts` — `qualityFor`**
- Add a `bestCpBeforeMoverPerspective: number` parameter (the mover-
  perspective eval of the position *before* the move — `classifyMove`
  already computes this as `bestCp`, just needs passing through).
- Split the current `cpLoss < INTERESTING_THRESHOLD_CP` branch. Today it's
  `isSacrifice ? 'brilliant' : 'good'` for the whole 0–19 range; that
  sacrifice check is unchanged and still wins across the whole range. Only
  the non-sacrifice half changes: `cpLoss === 0` → `best` (new), `cpLoss`
  1–19 → `good` (unchanged). So: sacrifice at any cpLoss 0–19 → `brilliant`;
  non-sacrifice at `cpLoss === 0` → `best`; non-sacrifice at 1–19 → `good`.
- New constant `WINNING_POSITION_CP = 300` (reuses the existing magnitude
  convention from `BLUNDER_THRESHOLD_CP`/`MISSED_CHANCE_GAP_CP`). When the
  computed quality would be `mistake` or `blunder` (`cpLoss >= 100`), and
  `bestCpBeforeMoverPerspective >= WINNING_POSITION_CP`, reclassify to
  `miss` instead.
- This is an approximation, not literal chess.com logic (which compares the
  engine's top-2 lines to detect a narrow tactical window). It answers "were
  you already winning big and gave a lot of it back" using data already
  computed for every move today — zero additional engine calls, works
  immediately on existing/re-run analyses.
- **Explicitly out of scope:** `critical-moments.ts` already has a
  `missed_chance` rule using true multi-PV line-gap detection, but it can
  never fire today because `analyzeGamePositions` (full-game analysis, used
  by `classifyMoves`) requests single-PV only — `COACH_ENGINE_MULTI_PV` only
  applies to the live coach's `get_engine_analysis` tool. Fixing that is a
  separate, real gap (multiPv on full-game import = more engine compute per
  game) and is not part of this change. Not to be confused with the new
  `miss` *quality* tier, which is a different, cheaper signal.

**`packages/chess-analysis/src/critical-moments.ts` — required fix**
- `userMistakeMoments` hardcodes `quality === 'mistake' || quality === 'blunder'`
  to decide which moves become `user_mistake` candidate moments for the
  coaching-plan LLM. Without adding `miss` here, any move reclassified from
  mistake/blunder to miss would silently stop being offered to the coach as
  a discussion-worthy moment — exactly backwards, since squandering a won
  position is one of the more useful things to coach on. Add `miss` to this
  check.
- `isSoundQuality` must also treat `miss` as unsound (currently only
  excludes `dubious`/`mistake`/`blunder`; `best` needs no change — it falls
  through to "sound" by default, correctly).

**`packages/prompts/src/analysis-planner.ts`**
- No code change needed: `qualityNote` already does a generic
  `MOVE_QUALITY_SYMBOLS[move.quality]` lookup for anything that isn't
  `good`, so `best` and `miss` moves will automatically get annotated for
  the planner LLM once the symbol map has entries for them.

## Frontend rendering changes

**New: `apps/web/src/features/board/MoveQualityBadge.tsx`**
- Small presentational component: `{ quality: MoveQuality | undefined, size: 'sm' | 'md' }`.
- Renders the colored circle + glyph for any tier except `good`/undefined
  (which render nothing). Shared by both `MoveExplorer` and `MoveStrip` so
  the badge markup exists in exactly one place instead of being duplicated
  across desktop and mobile.

**`apps/web/src/features/board/MoveExplorer.tsx`**
- `MoveCell` currently appends the NAG symbol as trailing text on the SAN
  button (`Nf3?!`). Replace with `<MoveQualityBadge quality={quality} size="md" />`
  rendered before the SAN text inside the button; SAN text keeps its
  existing `move-quality-${quality}` color-tint class.
- The "Show notes" panel's `{quality}: better was {bestLineSan}` line
  currently only skips `good`. It must also skip `best` — there's nothing
  better than the best move, so showing "best: better was Nf3" when Nf3 is
  what was played would read as broken.

**`apps/web/src/features/board/MoveStrip.tsx`**
- Add a `classifiedMoves: ClassifiedMoveDto[]` prop (currently has none —
  this component only knows `sanMoves`/`currentPly`/`momentPlies` today).
- Render `<MoveQualityBadge quality={...} size="sm" />` before each chip's
  SAN text, sized down (~12px vs ~18px on desktop) for the compact
  horizontal strip.
- The existing `momentPlies` dot indicator (coaching-plan moments, unrelated
  to move quality) is a separate visual signal (dot under the chip vs. badge
  before the text) and doesn't collide with the new badge.

**`apps/web/src/features/session/SessionPage.tsx`**
- Thread `gameQuery.data?.classifiedMoves ?? []` into `<MoveStrip>` — it's
  already fetched for `MoveExplorer`, just needs passing to the second
  consumer.

**CSS**
- `MoveExplorer.css` / `MoveStrip.css` each get badge-circle rules keyed off
  the (now 7, excluding `good`) `--quality-*` tokens, sized per component.
  Must remember the CSS-specificity lesson from the last round of this
  feature: badge/text-color selectors need to be at least as specific as
  the base `button` rule they override.

**`docs/design.md` update**
- §5.5 ("no color-coded good/bad markers") and principle #4's "no color-
  coded" language are now stale — this was already quietly true once
  `MoveExplorer`'s quality coloring shipped, undocumented. Update both to
  reflect the current, deliberate direction (quality badges are part of the
  primary UI; the "engine invisible" principle continues to mean no raw
  centipawn numbers or eval bars, which this feature doesn't introduce).

## Testing plan

- `packages/shared/src/schemas.test.ts` — extend tier/symbol assertions to
  all 8 tiers.
- `packages/chess-analysis/src/classify.test.ts` — new cases: `cpLoss === 0`
  → `best`; `cpLoss === 0` + sacrifice → still `brilliant`; mistake-range and
  blunder-range `cpLoss` from an already-winning position (`bestCp >= 300`)
  → `miss`; same `cpLoss` values from a non-winning position → unaffected
  (regression guard against over-firing miss).
- `packages/chess-analysis/src/critical-moments.test.ts` — a user move
  classified `miss` still produces a `user_mistake` candidate moment
  (regression guard for the required fix); `isSoundQuality('miss') === false`.
- `apps/web/.../MoveExplorer.test.tsx` — badge renders for `best`/`miss`
  fixtures with correct color class; "better was…" note suppressed for
  `best`.
- `apps/web/.../MoveStrip.test.tsx` — badge renders on a chip once
  `classifiedMoves` is supplied; absent for `good`/undefined moves.
- `apps/web/.../MoveQualityBadge.test.tsx` — direct unit test of the shared
  component (renders nothing for good/undefined, renders glyph+color for
  each other tier).
- **Live browser verification before calling this done** — this is a CSS/
  visual feature, and jsdom's `toHaveClass` assertions won't catch a
  rendering bug (exactly what happened with the CSS-specificity bug fixed
  earlier this session). Check both `MoveExplorer` (desktop ≥1080px) and
  `MoveStrip` (mobile) against a real analyzed game with a mix of tiers.

## Non-goals (explicitly deferred to future specs)

- Explain/Next review flow (callout bubble + step-through-moments buttons).
- Evaluation graph at the bottom of the session screen.
- Share/export (PGN download, image export).
- Chat avatar facelift (human-face icon + bubble refresh).
- Fixing `missed_chance`'s dormant multi-PV detection (separate, real gap;
  not part of this change).
