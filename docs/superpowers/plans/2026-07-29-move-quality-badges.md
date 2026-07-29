# Move Quality Badges (Best + Miss Tiers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the move-quality scale from 6 to 8 tiers (adding `best` and `miss`) and redesign both `MoveExplorer` (desktop) and `MoveStrip` (mobile) to show chess.com-style colored icon badges instead of trailing NAG-suffix text.

**Architecture:** A new shared `MoveQualityBadge` presentational component renders the badge for both consumers. `best` is a pure classification split (cpLoss === 0 becomes its own tier instead of folding into `good`). `miss` is a cheap heuristic reclassification of what would otherwise be `mistake`/`blunder` when the position was already clearly winning before the move — no new engine calls.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library, plain CSS (no icon library — the app uses Unicode glyphs natively throughout).

**Spec:** `docs/superpowers/specs/2026-07-29-move-quality-badges-design.md` — read it first if anything below is unclear on *why*.

## Global Constraints

- No new npm dependencies (no icon library) — badges are Unicode glyphs in colored circles, CSS only.
- Final 8-tier palette (glyph / color), do not deviate:
  `brilliant` `!!` `#2f7dc4` · `best` `★` `#5b9c6a` (new) · `good` *(no badge)* · `interesting` `!?` `#2f9e8f` · `dubious` `?!` `#c9a227` · `mistake` `?` `#d9622b` · `miss` `✕` `#a8477a` (new) · `blunder` `??` `#c0392b`.
- `miss` threshold: `WINNING_POSITION_CP = 300` (mover-perspective eval of the position *before* the move).
- CSS specificity rule learned earlier this project: any new per-quality color rule on a `<button>` inside `.move-explorer__list` / `.move-strip` MUST be written as `.move-explorer__list button.move-quality-X` / `.move-strip button.move-quality-X` (element+class prefix), never a bare `.move-quality-X` class selector — a bare class selector loses to the base `button` rule's specificity regardless of source order. Same reasoning applies to the `[aria-current='true']` combo override blocks: they must be at least as specific as the plain per-quality rules, or declared to win the specificity tie by being combined selectors (`button[aria-current='true'].move-quality-X`), not just relying on file order.
- `ClassifiedMoveDto.ply` is **1-based** (ply 1 = White's first half-move — matches `MoveExplorer`'s existing `pairMoves` convention). `MoveStrip`'s own internal `ply` variable is the **0-based** `sanMoves` array index (pre-existing, unrelated convention — do not change it). When looking up a chip's quality in `MoveStrip`, use `qualityByPly.get(ply + 1)`, not `qualityByPly.get(ply)`.
- Run `npx tsc -b` from the repo root after every task — the `Record<MoveQuality, string>` in `MOVE_QUALITY_SYMBOLS` will fail to compile if any tier is missing an entry, which is a useful correctness net for Task 1.

---

### Task 1: Shared quality tiers (`packages/shared`)

**Files:**
- Modify: `packages/shared/src/analysis.ts`
- Modify: `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Produces: `MoveQuality` type now includes `'best'` and `'miss'` (8-member union). `MOVE_QUALITY_SYMBOLS['best'] === '★'`, `MOVE_QUALITY_SYMBOLS['miss'] === '✕'`. Every later task depends on these two names existing exactly as `'best'` and `'miss'`.

- [ ] **Step 1: Update the failing test first**

In `packages/shared/src/schemas.test.ts`, find the `accepts every MOVE_QUALITIES tier` test and change the tier array:

```ts
  test('accepts every MOVE_QUALITIES tier', () => {
    for (const quality of ['brilliant', 'best', 'good', 'interesting', 'dubious', 'mistake', 'miss', 'blunder']) {
      expect(ClassifiedMoveSchema.safeParse({ ...validMove, quality }).success).toBe(true);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/schemas.test.ts`
Expected: FAIL — `best`/`miss` are rejected by the current `MoveQualitySchema` enum.

- [ ] **Step 3: Implement**

In `packages/shared/src/analysis.ts`, replace the two exports:

```ts
export const MOVE_QUALITIES = ['brilliant', 'best', 'good', 'interesting', 'dubious', 'mistake', 'miss', 'blunder'] as const;
export type MoveQuality = (typeof MOVE_QUALITIES)[number];

/** Chess.com/lichess-style NAG symbols for each quality tier. */
export const MOVE_QUALITY_SYMBOLS: Record<MoveQuality, string> = {
  brilliant: '!!',
  best: '★',
  good: '!',
  interesting: '!?',
  dubious: '?!',
  mistake: '?',
  miss: '✕',
  blunder: '??'
};
```

(Everything else in the file — `MoveQualitySchema`, `ClassifiedMoveSchema`, etc. — is unchanged; they derive from `MOVE_QUALITIES`/`MoveQuality` automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/schemas.test.ts`
Expected: PASS (all tests in the file, not just the one you changed).

- [ ] **Step 5: Type-check the whole repo**

Run: `npx tsc -b` from the repo root.
Expected: FAIL at this point — `packages/prompts/src/analysis-planner.ts`'s `Record`-typed lookups and `packages/chess-analysis`'s `qualityFor` are fine (they're generic), but nothing should actually break yet since nothing produces `'best'`/`'miss'` values yet. If it does fail, read the error — it's telling you where a later task's work is needed early; that's fine, just confirm it's not an unrelated regression.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/analysis.ts packages/shared/src/schemas.test.ts
git commit -m "feat(shared): add best and miss move-quality tiers"
```

---

### Task 2: Design tokens for Best/Miss colors

**Files:**
- Modify: `apps/web/src/styles/tokens.css`

**Interfaces:**
- Produces: CSS custom properties `--quality-best` (`#5b9c6a`) and `--quality-miss` (`#a8477a`), defined in all three theme blocks (`:root`, `:root[data-theme='light']`, `:root[data-theme='dark']`) — same value in every block, matching how the existing five `--quality-*` tokens and `--annotate-1`/`--annotate-2` are theme-invariant.

- [ ] **Step 1: Edit tokens.css**

In `apps/web/src/styles/tokens.css`, there are three blocks each containing this five-line group:
```css
  --quality-brilliant: #2f7dc4;
  --quality-interesting: #2f9e8f;
  --quality-dubious: #c9a227;
  --quality-mistake: #d9622b;
  --quality-blunder: #c0392b;
```
In **all three** occurrences (the `:root` block, the `:root[data-theme='light']` block, and the `:root[data-theme='dark']` block — NOT the `@media (prefers-color-scheme: dark)` block, which never defined quality tokens), replace with:
```css
  --quality-brilliant: #2f7dc4;
  --quality-best: #5b9c6a;
  --quality-interesting: #2f9e8f;
  --quality-dubious: #c9a227;
  --quality-mistake: #d9622b;
  --quality-miss: #a8477a;
  --quality-blunder: #c0392b;
```

- [ ] **Step 2: Verify with the existing token test**

Run: `cd apps/web && npx vitest run src/styles/tokens.test.ts`
Expected: PASS (this test doesn't enumerate quality tokens by name, so it won't fail either way — this step is a sanity check that the edit didn't break CSS parsing/other assertions, not new coverage).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/tokens.css
git commit -m "feat(web): add --quality-best and --quality-miss design tokens"
```

---

### Task 3: `classify.ts` — the `best` tier

**Files:**
- Modify: `packages/chess-analysis/src/classify.ts`
- Modify: `packages/chess-analysis/src/classify.test.ts`

**Interfaces:**
- Consumes: `MoveQuality` from Task 1 (now includes `'best'`).
- Produces: `qualityFor(cpLoss, isSacrifice)` now returns `'best'` instead of `'good'` when `cpLoss === 0` and the move isn't a sacrifice. `classifyMoves`/`classifyMove`'s public behavior changes correspondingly. (The `miss` tier and the `bestCpBeforeMoverPerspective` parameter are added in Task 4, not here — `qualityFor`'s signature is still 2 params after this task.)

- [ ] **Step 1: Update the existing tests that assert `'good'` for `cpLoss === 0`**

Six existing tests in `packages/chess-analysis/src/classify.test.ts` currently assert `quality` is `'good'` for a move with `cpLoss` 0. All six must change to `'best'`. Open the file and make these exact changes:

1. Test `'cpLoss 0 (played the engine-best move) classifies as good'` — rename and change assertion:
```ts
  test('cpLoss 0 (played the engine-best move) classifies as best', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 30), evalAt(AFTER_E4_FEN, 30), evalAt(AFTER_E4_E5_FEN, 30)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('best');
  });
```

2. Test `'the same non-capture move onto an undefended square stays good, not brilliant'` — rename and change the final assertion:
```ts
  test('the same non-capture move onto an undefended square stays best, not brilliant', () => {
    const beforeFen = '4k3/8/8/8/2B5/8/8/4K3 w - - 0 1';
    const afterFen = '4k3/8/4B3/8/8/8/8/4K3 b - - 1 1';
    const game: ParsedGame = {
      headers: {},
      positions: [
        { ply: 0, fen: beforeFen, moveSan: null, moveUci: null, mover: null },
        { ply: 1, fen: afterFen, moveSan: 'Be6', moveUci: 'c4e6', mover: 'white' }
      ]
    };
    const evals = [evalAt(beforeFen, 0), evalAt(afterFen, 0)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.quality).toBe('best');
  });
```

3. Test `'a capture is never classified as brilliant, even onto a defended square with low cpLoss'` — change only the final assertion from `'good'` to `'best'`:
```ts
    expect(whiteMove?.quality).toBe('best');
```
(the rest of that test body is unchanged.)

4. Test `'black-to-move perspective flip: black finds the objectively-best move, no cp loss'` — change the final assertion:
```ts
    expect(blackMove?.cpLoss).toBe(0);
    expect(blackMove?.quality).toBe('best');
```

5. Test `'black-to-move perspective flip: naive unflipped subtraction would give the wrong sign'` — change the final assertion:
```ts
    expect(blackMove?.cpLoss).toBe(0);
    expect(blackMove?.quality).toBe('best');
```

6. Test `'delivering checkmate is always cpLoss 0, even though the engine has no lines for the resulting no-legal-moves position'` — change the final assertion:
```ts
    expect(whiteMove?.cpLoss).toBe(0);
    expect(whiteMove?.quality).toBe('best');
```

- [ ] **Step 2: Add a new regression-guard test**

Add this test to the same `describe('classifyMoves', ...)` block (anywhere after the tests above), guarding that only an *exact* cpLoss of 0 becomes `best` — the rest of the near-best band (1–19) must stay `good`:

```ts
  test('cpLoss 5 (near best but not exact) stays good, not best', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 100), evalAt(AFTER_E4_FEN, 95), evalAt(AFTER_E4_E5_FEN, 95)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(5);
    expect(whiteMove?.quality).toBe('good');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/chess-analysis && npx vitest run src/classify.test.ts`
Expected: FAIL — the 6 updated tests and the 1 new test all fail because `classify.ts` still returns `'good'` for `cpLoss === 0`.

- [ ] **Step 4: Implement**

In `packages/chess-analysis/src/classify.ts`, change the last line of `qualityFor`:

```ts
export function qualityFor(cpLoss: number, isSacrifice = false): MoveQuality {
  if (cpLoss >= BLUNDER_THRESHOLD_CP) return 'blunder';
  if (cpLoss >= MISTAKE_THRESHOLD_CP) return 'mistake';
  if (cpLoss >= DUBIOUS_THRESHOLD_CP) return 'dubious';
  if (cpLoss >= INTERESTING_THRESHOLD_CP) return 'interesting';
  if (isSacrifice) return 'brilliant';
  return cpLoss === 0 ? 'best' : 'good';
}
```
(This replaces the old single-line `return isSacrifice ? 'brilliant' : 'good';` with the sacrifice check split out, followed by the new best/good split. Sacrifice still wins across the whole 0–19 range, exactly as before — only the non-sacrifice branch is new.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/chess-analysis && npx vitest run src/classify.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Type-check and run the full chess-analysis suite**

Run: `npx tsc -b && cd packages/chess-analysis && npx vitest run`
Expected: PASS. (`critical-moments.test.ts` in the same package should still pass unchanged — it doesn't use `cpLoss === 0` fixtures with quality `'good'` in a way this touches.)

- [ ] **Step 7: Commit**

```bash
git add packages/chess-analysis/src/classify.ts packages/chess-analysis/src/classify.test.ts
git commit -m "feat(chess-analysis): split the best tier out of good (cpLoss === 0)"
```

---

### Task 4: `classify.ts` — the `miss` tier

**Files:**
- Modify: `packages/chess-analysis/src/classify.ts`
- Modify: `packages/chess-analysis/src/classify.test.ts`

**Interfaces:**
- Consumes: `qualityFor(cpLoss, isSacrifice)` from Task 3.
- Produces: `qualityFor(cpLoss, isSacrifice, bestCpBeforeMoverPerspective)` — 3rd parameter, default `0`. Returns `'miss'` instead of `'mistake'`/`'blunder'` when `cpLoss >= MISTAKE_THRESHOLD_CP` (100) and `bestCpBeforeMoverPerspective >= WINNING_POSITION_CP` (300, new exported-if-needed constant — it does not need to be exported, only used internally). `isSoundQuality` now also returns `false` for `'miss'`. `classifyMove` now calls `qualityFor(cpLoss, sacrifice, bestCp)` (3 args) — `bestCp` is the same variable already computed at the top of `classifyMove`, just threaded through.

- [ ] **Step 1: Update the 2 existing tests that now hit the miss condition**

Two existing tests in `classify.test.ts` use a `bestCp` (before the move, mover perspective) of ≥300 together with a mistake/blunder-range `cpLoss` — they currently assert `'blunder'`, but will now correctly be `'miss'`. Update both:

1. Test `'clamps cpLoss at 1000 even when the raw gap is larger'`:
```ts
  test('clamps cpLoss at 1000 even when the raw gap is larger', () => {
    const game = twoPlyGame();
    const evals = [
      evalAt(START_FEN, 900),
      evalAt(AFTER_E4_FEN, -900),
      evalAt(AFTER_E4_E5_FEN, -900)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(1000);
    expect(whiteMove?.quality).toBe('miss');
  });
```
(White was +900 before the move — clearly winning — so a 1000cp-clamped collapse is now a `miss`, not a `blunder`.)

2. Test `'missing an available mate maps the miss to 1000 cpLoss'` — rename (the old title's "miss" was colloquial, not the tier name, which is confusing now that `miss` is a real tier) and update the assertion:
```ts
  test('missing an available mate reclassifies a would-be blunder as miss', () => {
    const game = twoPlyGame();
    // White had mate-in-3 available (mateIn: 3 -> +1000cp, white perspective,
    // mover is white so no flip) but instead played a move leaving a roughly
    // equal position (0 cp) at ply 1. Having a forced mate available counts
    // as "clearly winning" for the miss heuristic.
    const evals = [
      evalAt(START_FEN, null, 3),
      evalAt(AFTER_E4_FEN, 0, null),
      evalAt(AFTER_E4_E5_FEN, 0, null)
    ];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(1000);
    expect(whiteMove?.quality).toBe('miss');
  });
```

- [ ] **Step 2: Add new tests for the miss tier**

Add these to the `describe('classifyMoves', ...)` block:

```ts
  test('a mistake-range cpLoss from an already-winning position (bestCp >= 300) classifies as miss', () => {
    const game = twoPlyGame();
    // White was +300 before the move (exactly at the winning threshold), and
    // gives back 150cp (mistake-range on its own) — reclassified as miss.
    const evals = [evalAt(START_FEN, 300), evalAt(AFTER_E4_FEN, 150), evalAt(AFTER_E4_E5_FEN, 150)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(150);
    expect(whiteMove?.quality).toBe('miss');
  });

  test('the same mistake-range cpLoss stays mistake when the position was NOT already winning (bestCp just below 300)', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 299), evalAt(AFTER_E4_FEN, 149), evalAt(AFTER_E4_E5_FEN, 149)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(150);
    expect(whiteMove?.quality).toBe('mistake');
  });

  test('a blunder-range cpLoss from an already-winning position classifies as miss, not blunder', () => {
    const game = twoPlyGame();
    const evals = [evalAt(START_FEN, 500), evalAt(AFTER_E4_FEN, 50), evalAt(AFTER_E4_E5_FEN, 50)];

    const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

    expect(whiteMove?.cpLoss).toBe(450);
    expect(whiteMove?.quality).toBe('miss');
  });
```

Also add a new top-level `describe` block for `isSoundQuality` (add `isSoundQuality` to the existing import line at the top of the file — change `import { classifyMoves } from './classify.js';` to `import { classifyMoves, isSoundQuality } from './classify.js';`):

```ts
describe('isSoundQuality', () => {
  test('miss is not sound (it is a real error, just from a winning position)', () => {
    expect(isSoundQuality('miss')).toBe(false);
  });

  test('best is sound', () => {
    expect(isSoundQuality('best')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/chess-analysis && npx vitest run src/classify.test.ts`
Expected: FAIL — the 2 updated tests and all new tests fail (miss doesn't exist yet; `isSoundQuality` isn't exported with the new behavior).

- [ ] **Step 4: Implement**

In `packages/chess-analysis/src/classify.ts`:

Add the new constant near the top, alongside the existing thresholds:
```ts
const MATE_CP = 1000;
const INTERESTING_THRESHOLD_CP = 20;
const DUBIOUS_THRESHOLD_CP = 50;
const MISTAKE_THRESHOLD_CP = 100;
const BLUNDER_THRESHOLD_CP = 300;
const WINNING_POSITION_CP = 300;
```

Update the `classifyMove` call site (find `quality: qualityFor(cpLoss, sacrifice),` inside the returned object) to pass `bestCp` as a third argument:
```ts
    quality: qualityFor(cpLoss, sacrifice, bestCp),
```

Replace `qualityFor` in full:
```ts
/**
 * Bucket a non-negative centipawn loss (plus the sacrifice signal and the
 * mover-perspective eval of the position BEFORE the move) into a move
 * quality per the fixed thresholds.
 *
 * `bestCpBeforeMoverPerspective` powers the `miss` tier: a move that would
 * otherwise be a `mistake`/`blunder` (cpLoss >= MISTAKE_THRESHOLD_CP)
 * reclassifies to `miss` when the mover was already clearly winning
 * (>= WINNING_POSITION_CP) before playing it — "you were winning big and
 * gave a lot of it back". This is an approximation, not true chess.com-style
 * detection (which compares the engine's top-2 lines) — see
 * docs/superpowers/specs/2026-07-29-move-quality-badges-design.md.
 */
export function qualityFor(cpLoss: number, isSacrifice = false, bestCpBeforeMoverPerspective = 0): MoveQuality {
  const wasWinningBig = bestCpBeforeMoverPerspective >= WINNING_POSITION_CP;
  if (cpLoss >= BLUNDER_THRESHOLD_CP) return wasWinningBig ? 'miss' : 'blunder';
  if (cpLoss >= MISTAKE_THRESHOLD_CP) return wasWinningBig ? 'miss' : 'mistake';
  if (cpLoss >= DUBIOUS_THRESHOLD_CP) return 'dubious';
  if (cpLoss >= INTERESTING_THRESHOLD_CP) return 'interesting';
  if (isSacrifice) return 'brilliant';
  return cpLoss === 0 ? 'best' : 'good';
}
```

Update `isSoundQuality`:
```ts
/** True for any tier that isn't an error (dubious/mistake/miss/blunder) —
 * the "this move was fine" check used by callers that only cared about the
 * old two-way good/bad split before quality grew brilliant/interesting/
 * best/miss tiers. */
export function isSoundQuality(quality: MoveQuality): boolean {
  return quality !== 'dubious' && quality !== 'mistake' && quality !== 'blunder' && quality !== 'miss';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/chess-analysis && npx vitest run src/classify.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Type-check**

Run: `npx tsc -b` from the repo root.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/chess-analysis/src/classify.ts packages/chess-analysis/src/classify.test.ts
git commit -m "feat(chess-analysis): add the miss tier (winning position + mistake/blunder-range cpLoss)"
```

---

### Task 5: `critical-moments.ts` — treat `miss` as a real user mistake

**Files:**
- Modify: `packages/chess-analysis/src/critical-moments.ts`
- Modify: `packages/chess-analysis/src/critical-moments.test.ts`

**Interfaces:**
- Consumes: `ClassifiedMove.quality` can now be `'miss'` (Task 4). `isSoundQuality` (Task 4) already excludes `'miss'` — no change needed for the `missedChanceMoments` rule, which uses `isSoundQuality`.
- Produces: `findCandidateMoments` now includes a `user_mistake` candidate moment for any user move with `quality === 'miss'`, same as `mistake`/`blunder`.

**Why this task exists:** without it, a move reclassified from `mistake`/`blunder` to `miss` by Task 4 would silently stop being offered to the coaching-plan LLM as a discussion-worthy moment — squandering a winning position is exactly the kind of thing worth coaching on, so this would be a real regression, not just a missed enhancement.

- [ ] **Step 1: Write the failing test**

Add this test to `packages/chess-analysis/src/critical-moments.test.ts`, inside the `describe('findCandidateMoments', ...)` block:

```ts
  test('flags a user miss the same as mistake/blunder', () => {
    const moves = [move({ ply: 1, isUserMove: true, quality: 'miss', cpLoss: 200 })];
    const evals = [evalWithLines([line('e4', 0)])];

    expect(findCandidateMoments(moves, evals)).toEqual([{ ply: 1, kind: 'user_mistake', cpLoss: 200 }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/chess-analysis && npx vitest run src/critical-moments.test.ts`
Expected: FAIL — `findCandidateMoments` returns `[]` because `userMistakeMoments` doesn't recognize `'miss'` yet.

- [ ] **Step 3: Implement**

In `packages/chess-analysis/src/critical-moments.ts`, update `userMistakeMoments`:

```ts
/** Rule (a): every mistake/blunder/miss the user played. */
function userMistakeMoments(moves: ClassifiedMove[]): CandidateMoment[] {
  return moves
    .filter(
      (move) =>
        move.isUserMove && (move.quality === 'mistake' || move.quality === 'blunder' || move.quality === 'miss')
    )
    .map((move): CandidateMoment => ({ ply: move.ply, kind: 'user_mistake', cpLoss: move.cpLoss }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/chess-analysis && npx vitest run src/critical-moments.test.ts`
Expected: PASS, all tests (including the pre-existing ones — this change is additive, it doesn't change behavior for `mistake`/`blunder`).

- [ ] **Step 5: Run the whole chess-analysis package and type-check**

Run: `npx tsc -b && cd packages/chess-analysis && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/chess-analysis/src/critical-moments.ts packages/chess-analysis/src/critical-moments.test.ts
git commit -m "fix(chess-analysis): surface miss-quality moves as coaching-plan candidate moments"
```

---

### Task 6: `MoveQualityBadge` — new shared component

**Files:**
- Create: `apps/web/src/features/board/MoveQualityBadge.tsx`
- Create: `apps/web/src/features/board/MoveQualityBadge.css`
- Create: `apps/web/src/features/board/MoveQualityBadge.test.tsx`

**Interfaces:**
- Consumes: `MoveQuality` and `MOVE_QUALITY_SYMBOLS` from `@chess-coach/shared` (Task 1). `--quality-*` CSS tokens from `tokens.css` (Task 2).
- Produces: `MoveQualityBadge({ quality: MoveQuality | undefined, size: 'sm' | 'md' })` — a React component. Renders `null` for `quality === 'good'` or `quality === undefined`. Otherwise renders a `<span>` with classes `move-quality-badge`, `move-quality-badge--{size}`, `move-quality-badge--{quality}`, containing the glyph text (`MOVE_QUALITY_SYMBOLS[quality]`). Later tasks (7, 8) import this from `./MoveQualityBadge.js`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/board/MoveQualityBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MoveQualityBadge } from './MoveQualityBadge.js';

describe('MoveQualityBadge', () => {
  test('renders nothing for a good move', () => {
    const { container } = render(<MoveQualityBadge quality="good" size="md" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when quality is undefined', () => {
    const { container } = render(<MoveQualityBadge quality={undefined} size="md" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders the star glyph for best, sized md', () => {
    render(<MoveQualityBadge quality="best" size="md" />);
    const badge = screen.getByText('★');
    expect(badge).toHaveClass('move-quality-badge--best');
    expect(badge).toHaveClass('move-quality-badge--md');
  });

  test('renders the X glyph for miss, sized sm', () => {
    render(<MoveQualityBadge quality="miss" size="sm" />);
    const badge = screen.getByText('✕');
    expect(badge).toHaveClass('move-quality-badge--miss');
    expect(badge).toHaveClass('move-quality-badge--sm');
  });

  test('renders the double-exclamation glyph for brilliant', () => {
    render(<MoveQualityBadge quality="brilliant" size="md" />);
    expect(screen.getByText('!!')).toHaveClass('move-quality-badge--brilliant');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/features/board/MoveQualityBadge.test.tsx`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/features/board/MoveQualityBadge.tsx`:

```tsx
import type { ReactNode } from 'react';
import { MOVE_QUALITY_SYMBOLS, type MoveQuality } from '@chess-coach/shared';
import './MoveQualityBadge.css';

export interface MoveQualityBadgeProps {
  quality: MoveQuality | undefined;
  size: 'sm' | 'md';
}

/** Chess.com-style colored circle + glyph for a move's quality tier. Shared
 * by MoveExplorer (desktop, size="md") and MoveStrip (mobile, size="sm") so
 * the badge markup/styling exists in exactly one place. Renders nothing for
 * 'good' or undefined — those are intentionally badge-less (design spec
 * docs/superpowers/specs/2026-07-29-move-quality-badges-design.md). */
export function MoveQualityBadge({ quality, size }: MoveQualityBadgeProps): ReactNode {
  if (!quality || quality === 'good') return null;
  return (
    <span className={`move-quality-badge move-quality-badge--${size} move-quality-badge--${quality}`}>
      {MOVE_QUALITY_SYMBOLS[quality]}
    </span>
  );
}
```

Create `apps/web/src/features/board/MoveQualityBadge.css`:

```css
.move-quality-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-weight: 700;
  /* Fixed dark glyph color regardless of theme — contrast here is against
   * the badge's own colored circle, not the page background, so it doesn't
   * need a theme-aware token (same reasoning as --annotate-1/--annotate-2
   * in tokens.css). */
  color: #15140f;
  flex-shrink: 0;
}

.move-quality-badge--md {
  width: 18px;
  height: 18px;
  font-size: 10px;
}

.move-quality-badge--sm {
  width: 12px;
  height: 12px;
  font-size: 7px;
}

.move-quality-badge--brilliant { background: var(--quality-brilliant); }
.move-quality-badge--best { background: var(--quality-best); }
.move-quality-badge--interesting { background: var(--quality-interesting); }
.move-quality-badge--dubious { background: var(--quality-dubious); }
.move-quality-badge--mistake { background: var(--quality-mistake); }
.move-quality-badge--miss { background: var(--quality-miss); }
.move-quality-badge--blunder { background: var(--quality-blunder); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/features/board/MoveQualityBadge.test.tsx`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Type-check**

Run: `npx tsc -b` from the repo root.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/board/MoveQualityBadge.tsx apps/web/src/features/board/MoveQualityBadge.css apps/web/src/features/board/MoveQualityBadge.test.tsx
git commit -m "feat(web): add shared MoveQualityBadge component"
```

---

### Task 7: `MoveExplorer` — use the badge, fix the notes panel

**Files:**
- Modify: `apps/web/src/features/board/MoveExplorer.tsx`
- Modify: `apps/web/src/features/board/MoveExplorer.css`
- Modify: `apps/web/src/features/board/MoveExplorer.test.tsx`

**Interfaces:**
- Consumes: `MoveQualityBadge` from Task 6. `--quality-best`/`--quality-miss` tokens from Task 2.
- Produces: no change to `MoveExplorerProps` — this task only changes internal rendering.

- [ ] **Step 1: Update the existing tests for the new button structure**

Badges now render *before* the SAN text (not appended as a trailing suffix), so the button's accessible name changes from `'Qh5?!'` (suffix) to `'?!Qh5'` (prefix). Update these two existing tests in `apps/web/src/features/board/MoveExplorer.test.tsx`:

```ts
  test('renders a NAG symbol for a non-good move, but none for a good move', () => {
    const classifiedMoves = [
      classifiedMove({ ply: 3, moveSan: 'Qh5', quality: 'dubious' }),
      classifiedMove({ ply: 1, moveSan: 'e4', quality: 'good' })
    ];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '?!Qh5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'e4' })).toBeInTheDocument();
  });

  test('applies a quality-specific class per move for color coding', () => {
    const classifiedMoves = [
      classifiedMove({ ply: 7, moveSan: 'Qxf7#', quality: 'blunder' }),
      classifiedMove({ ply: 3, moveSan: 'Qh5', quality: 'brilliant' })
    ];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '??Qxf7#' })).toHaveClass('move-quality-blunder');
    expect(screen.getByRole('button', { name: '!!Qh5' })).toHaveClass('move-quality-brilliant');
  });
```

- [ ] **Step 2: Add new tests for best/miss and the notes-panel fix**

Add these to the same `describe('MoveExplorer', ...)` block:

```ts
  test('renders a star badge for a best move', () => {
    const classifiedMoves = [classifiedMove({ ply: 1, moveSan: 'e4', quality: 'best' })];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '★e4' })).toHaveClass('move-quality-best');
  });

  test('renders an X badge for a miss', () => {
    const classifiedMoves = [classifiedMove({ ply: 3, moveSan: 'Qh5', quality: 'miss' })];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '✕Qh5' })).toHaveClass('move-quality-miss');
  });

  test('the "show notes" panel does not show a "better was" note for a best move (nothing to improve on)', async () => {
    const user = userEvent.setup();
    const classifiedMoves = [classifiedMove({ ply: 1, moveSan: 'e4', quality: 'best', bestLineSan: ['e4'] })];
    render(<MoveExplorer sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={1} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /show notes/i }));

    expect(screen.queryByText(/better was/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/features/board/MoveExplorer.test.tsx`
Expected: FAIL — the updated and new tests fail against the current suffix-text implementation.

- [ ] **Step 4: Implement — update MoveExplorer.tsx**

In `apps/web/src/features/board/MoveExplorer.tsx`:

Change the import line from:
```ts
import { MOVE_QUALITY_SYMBOLS, type ClassifiedMoveDto } from '@chess-coach/shared';
```
to:
```ts
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { MoveQualityBadge } from './MoveQualityBadge.js';
```
(keep the existing `import './MoveExplorer.css';` line below it)

Change the notes-panel condition (find `{notesVisible && currentMove && currentMove.quality !== 'good' && currentMove.bestLineSan.length > 0 && (`) to also exclude `'best'`:
```tsx
      {notesVisible &&
        currentMove &&
        currentMove.quality !== 'good' &&
        currentMove.quality !== 'best' &&
        currentMove.bestLineSan.length > 0 && (
          <p className="move-explorer__note">
            {currentMove.quality}: better was {currentMove.bestLineSan.join(' ')}
          </p>
        )}
```

Replace the `MoveCell` function body:
```tsx
function MoveCell({ ply, san, quality, isCurrent, onSelect }: MoveCellProps): ReactNode {
  return (
    <button
      type="button"
      className={quality ? `move-quality-${quality}` : undefined}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={() => onSelect(ply)}
    >
      <MoveQualityBadge quality={quality} size="md" />
      {san}
    </button>
  );
}
```
(this removes the old `const symbol = quality && quality !== 'good' ? MOVE_QUALITY_SYMBOLS[quality] : '';` line and the trailing `{symbol}` — the badge component now owns glyph lookup entirely.)

- [ ] **Step 5: Implement — update MoveExplorer.css**

In `apps/web/src/features/board/MoveExplorer.css`, the quality color-coding block currently has 5 rules plus a 5-selector `[aria-current='true']` combo block. Replace that whole section (from the `/* Quality color coding... */` comment through the end of the combo block) with:

```css
/* Quality color coding, brilliant (blue) through blunder (red) — Daniel's
 * requested gradient. Doesn't override the current-move highlight above.
 * Selectors are prefixed with `.move-explorer__list button` to out-specificity
 * that base rule's `color: var(--text)` above (a bare `.move-quality-*` class
 * selector loses to a class+element selector regardless of source order, so
 * the color never actually showed until this was added). */
.move-explorer__list button.move-quality-brilliant {
  color: var(--quality-brilliant);
  font-weight: 600;
}
.move-explorer__list button.move-quality-best {
  color: var(--quality-best);
  font-weight: 600;
}
.move-explorer__list button.move-quality-interesting {
  color: var(--quality-interesting);
}
.move-explorer__list button.move-quality-dubious {
  color: var(--quality-dubious);
}
.move-explorer__list button.move-quality-mistake {
  color: var(--quality-mistake);
}
.move-explorer__list button.move-quality-miss {
  color: var(--quality-miss);
}
.move-explorer__list button.move-quality-blunder {
  color: var(--quality-blunder);
  font-weight: 600;
}

.move-explorer__list button[aria-current='true'].move-quality-brilliant,
.move-explorer__list button[aria-current='true'].move-quality-best,
.move-explorer__list button[aria-current='true'].move-quality-interesting,
.move-explorer__list button[aria-current='true'].move-quality-dubious,
.move-explorer__list button[aria-current='true'].move-quality-mistake,
.move-explorer__list button[aria-current='true'].move-quality-miss,
.move-explorer__list button[aria-current='true'].move-quality-blunder {
  color: var(--accent-contrast);
}
```

Also add a small gap so the badge doesn't touch the SAN text — in the same file, find:
```css
.move-explorer__list button {
  background: none;
  border: none;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 14px;
  color: var(--text);
}
```
and add `display: inline-flex; align-items: center; gap: 3px;`:
```css
.move-explorer__list button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 14px;
  color: var(--text);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/features/board/MoveExplorer.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 7: Type-check**

Run: `npx tsc -b` from the repo root.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/board/MoveExplorer.tsx apps/web/src/features/board/MoveExplorer.css apps/web/src/features/board/MoveExplorer.test.tsx
git commit -m "feat(web): render MoveQualityBadge in MoveExplorer, support best/miss tiers"
```

---

### Task 8: `MoveStrip` + `SessionPage` — bring badges to mobile

**Files:**
- Modify: `apps/web/src/features/board/MoveStrip.tsx`
- Modify: `apps/web/src/features/board/MoveStrip.css`
- Modify: `apps/web/src/features/board/MoveStrip.test.tsx`
- Modify: `apps/web/src/features/session/SessionPage.tsx`

**Interfaces:**
- Consumes: `MoveQualityBadge` from Task 6. `ClassifiedMoveDto` from `@chess-coach/shared` (Task 1).
- Produces: `MoveStripProps` gains a required `classifiedMoves: ClassifiedMoveDto[]` field. `SessionPage` passes `gameQuery.data?.classifiedMoves ?? []` into it (mirroring what it already does for `MoveExplorer`).

**Critical detail:** `ClassifiedMoveDto.ply` is 1-based; `MoveStrip`'s own local `ply` (the `sanMoves` array index used for `onSelect`/`aria-current`/`moment` — pre-existing, do not change) is 0-based. The quality lookup must use `qualityByPly.get(ply + 1)`.

- [ ] **Step 1: Update the existing tests to pass `classifiedMoves`**

`classifiedMoves` becomes a required prop. Update all three existing `render(<MoveStrip .../>)` calls in `apps/web/src/features/board/MoveStrip.test.tsx` to add `classifiedMoves={[]}`:

```ts
  test('renders move numbers and SAN, marking the current ply', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={2} momentPlies={[]} onSelect={vi.fn()} />);
    // ... rest unchanged
```
```ts
  test('marks moment plies with a dot', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={0} momentPlies={[3]} onSelect={vi.fn()} />);
    // ... rest unchanged
```
```ts
  test('tapping a move calls onSelect with its ply', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={0} momentPlies={[]} onSelect={onSelect} />);
    // ... rest unchanged
```

- [ ] **Step 2: Add new tests for badge rendering and ply alignment**

Add these to the same `describe('MoveStrip', ...)` block. `SAN_MOVES` is `['e4', 'e5', 'Nf3', 'Nc6']` (already defined at the top of the file) — array index 2 is `'Nf3'`, which is `ClassifiedMoveDto.ply === 3` (1-based: e4=1, e5=2, Nf3=3, Nc6=4).

```ts
  test('renders a quality badge on the chip matching ClassifiedMoveDto.ply (1-based), not the local 0-based index', () => {
    const classifiedMoves = [
      {
        ply: 3,
        moveSan: 'Nf3',
        mover: 'white' as const,
        isUserMove: false,
        cpLoss: 400,
        quality: 'blunder' as const,
        bestLineSan: ['Nc3'],
        evalAfterCp: -400
      }
    ];
    render(
      <MoveStrip sanMoves={SAN_MOVES} classifiedMoves={classifiedMoves} currentPly={0} momentPlies={[]} onSelect={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: /nf3/i })).toHaveClass('move-quality-blunder');
    expect(screen.getByRole('button', { name: /nc6/i }).className).not.toMatch(/move-quality-/);
  });

  test('renders no quality class for a chip with no matching classified move', () => {
    render(<MoveStrip sanMoves={SAN_MOVES} classifiedMoves={[]} currentPly={0} momentPlies={[]} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'e4' }).className).not.toMatch(/move-quality-/);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/features/board/MoveStrip.test.tsx`
Expected: FAIL — `classifiedMoves` isn't a recognized prop yet (TS error surfaces as a test failure/type error), and no badge rendering exists.

- [ ] **Step 4: Implement — update MoveStrip.tsx**

Replace the full contents of `apps/web/src/features/board/MoveStrip.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { MoveQualityBadge } from './MoveQualityBadge.js';
import './MoveStrip.css';

export interface MoveStripProps {
  sanMoves: string[];
  classifiedMoves: ClassifiedMoveDto[];
  currentPly: number;
  momentPlies: number[];
  onSelect: (ply: number) => void;
}

/** design.md §5.5: horizontal move-number chip list, peek-mode navigation.
 * Quality badges mirror MoveExplorer (design spec
 * 2026-07-29-move-quality-badges) — note ClassifiedMoveDto.ply is 1-based
 * while this component's own `ply` (the sanMoves array index, used for
 * onSelect/aria-current/moment — pre-existing convention) is 0-based, so the
 * quality lookup is offset by one. */
export function MoveStrip({ sanMoves, classifiedMoves, currentPly, momentPlies, onSelect }: MoveStripProps): ReactNode {
  const momentSet = new Set(momentPlies);
  const qualityByPly = new Map(classifiedMoves.map((move) => [move.ply, move.quality]));

  return (
    <div className="move-strip">
      {sanMoves.map((san, ply) => {
        const isCurrent = ply === currentPly;
        const isMoment = momentSet.has(ply);
        const quality = qualityByPly.get(ply + 1);
        const className = [isMoment ? 'moment' : null, quality ? `move-quality-${quality}` : null]
          .filter(Boolean)
          .join(' ');
        const children = [];
        if (ply % 2 === 0) {
          children.push(
            <span key={`num-${ply}`} className="move-number">
              {ply / 2 + 1}.
            </span>
          );
        }
        children.push(
          <button
            key={ply}
            type="button"
            className={className || undefined}
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onSelect(ply)}
          >
            <MoveQualityBadge quality={quality} size="sm" />
            {san}
          </button>
        );
        return children;
      })}
    </div>
  );
}
```

- [ ] **Step 5: Implement — update MoveStrip.css**

First, merge two new properties into the file's *existing* `.move-strip button { ... }` rule (do not add a second, duplicate `.move-strip button` selector — find the current rule and add `display: inline-flex; align-items: center; gap: 2px;` to it):

```css
.move-strip button {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: none;
  border: none;
  border-radius: 6px;
  padding: 6px 8px;
  min-height: 32px;
  font-size: 14px;
}
```

Then append this new block to the end of the file:

```css
/* Quality color coding, mirrors MoveExplorer.css's approach (design spec
 * 2026-07-29-move-quality-badges) and the same specificity lesson: prefixed
 * with `.move-strip button` so these beat the base button rule, and the
 * [aria-current='true'] combo block below is needed to win the specificity
 * tie against these plain rules (same selector weight, so source order
 * alone isn't reliable). */
.move-strip button.move-quality-brilliant { color: var(--quality-brilliant); font-weight: 600; }
.move-strip button.move-quality-best { color: var(--quality-best); font-weight: 600; }
.move-strip button.move-quality-interesting { color: var(--quality-interesting); }
.move-strip button.move-quality-dubious { color: var(--quality-dubious); }
.move-strip button.move-quality-mistake { color: var(--quality-mistake); }
.move-strip button.move-quality-miss { color: var(--quality-miss); }
.move-strip button.move-quality-blunder { color: var(--quality-blunder); font-weight: 600; }

.move-strip button[aria-current='true'].move-quality-brilliant,
.move-strip button[aria-current='true'].move-quality-best,
.move-strip button[aria-current='true'].move-quality-interesting,
.move-strip button[aria-current='true'].move-quality-dubious,
.move-strip button[aria-current='true'].move-quality-mistake,
.move-strip button[aria-current='true'].move-quality-miss,
.move-strip button[aria-current='true'].move-quality-blunder {
  color: var(--accent-contrast);
}
```

- [ ] **Step 6: Wire `classifiedMoves` through SessionPage**

In `apps/web/src/features/session/SessionPage.tsx`, find the `<MoveStrip .../>` usage (inside the `!isDesktop &&` block) and add the `classifiedMoves` prop, matching how `MoveExplorer` already receives it:

```tsx
          {!isDesktop && (
            <MoveStrip
              sanMoves={sanMoves}
              classifiedMoves={gameQuery.data?.classifiedMoves ?? []}
              currentPly={boardState.ply}
              momentPlies={[]}
              onSelect={boardState.peekAt}
            />
          )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/features/board/MoveStrip.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 8: Run the full SessionPage test file to check for regressions**

Run: `cd apps/web && npx vitest run src/features/session/SessionPage.test.tsx`
Expected: PASS — this task doesn't change `SessionPage`'s test-visible behavior (the `classifiedMoves` fixtures already flow through `gameQuery.data`), so no test updates should be needed here. If something fails, read the diff carefully before changing test expectations — it likely means the prop wiring in Step 6 has a typo.

- [ ] **Step 9: Type-check and run the whole apps/web suite**

Run: `npx tsc -b && cd apps/web && npx vitest run`
Expected: PASS, no regressions anywhere else in the app.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/board/MoveStrip.tsx apps/web/src/features/board/MoveStrip.css apps/web/src/features/board/MoveStrip.test.tsx apps/web/src/features/session/SessionPage.tsx
git commit -m "feat(web): render quality badges on the mobile MoveStrip"
```

---

### Task 9: Update `docs/design.md`

**Files:**
- Modify: `docs/design.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update principle #4**

Find (in `## 1. Design principles`, item 4):
```
4. **Engine invisible.** No eval bars, no centipawn numbers, no engine lines in
   the primary UI. The one exception: the opt-in Explore panel (§5.6), clearly
   labeled as exploration.
```
Replace with:
```
4. **Engine invisible.** No eval bars, no centipawn numbers, no engine lines in
   the primary UI. The one exception: the opt-in Explore panel (§5.6), clearly
   labeled as exploration. Move-quality badges (§5.5) are a deliberate,
   narrower exception too — they show a qualitative tier (a colored icon:
   best/miss/blunder/etc.), never a raw number.
```

- [ ] **Step 2: Update §5.5**

Find (in `## 5. The session screen`, section `### 5.5 Move strip`):
```
### 5.5 Move strip

Horizontal chip list `1. e4 e5 2. ♘f3 …`; current ply filled `--accent`; moves
at coaching-plan moments get a small dot under them (no color-coded
good/bad markers — the coach reveals judgments in conversation, the UI doesn't
spoil). Keyboard ←/→ on desktop; swipe left/right on the board on mobile.
```
Replace with:
```
### 5.5 Move strip / move explorer

Horizontal chip list on mobile (`1. e4 e5 2. ♘f3 …`) / paired move list on
desktop; current ply filled `--accent`; moves at coaching-plan moments get a
small dot under them. Every move also carries a quality badge — a small
colored circle + glyph (★ best, !! brilliant, !? interesting, ?! dubious,
? mistake, ✕ miss, ?? blunder; plain "good" moves get no badge) — computed
from the game's engine analysis, matching between mobile and desktop (see
`docs/superpowers/specs/2026-07-29-move-quality-badges-design.md`). Keyboard
←/→ on desktop; swipe left/right on the board on mobile.
```

- [ ] **Step 3: Commit**

```bash
git add docs/design.md
git commit -m "docs: update design.md for move quality badges (supersedes 'no color-coded markers')"
```

---

### Task 10: Live browser verification (manual, no commit)

**Files:** none — this is a manual verification pass, not a code change.

This feature is CSS/visual. jsdom-based tests (`toHaveClass`, `getByText`) cannot catch a rendering bug — exactly what happened earlier in this project with a CSS-specificity bug that silently prevented `MoveExplorer`'s original color-coding from ever showing despite all its tests passing. Do not report this plan as complete without this step.

- [ ] **Step 1: Start the dev stack**

If not already running: `docker compose up -d` from the repo root (or whatever the project's documented dev-stack command is — check `docs/architecture.md` if unsure). Confirm `http://localhost:5173` and the API are reachable.

- [ ] **Step 2: Re-run migrations/re-analyze if needed**

The `miss`/`best` tiers are computed at analysis time (`classifyMoves`), not read time — any game analyzed *before* this change has its old `classifiedMoves` persisted with the old 6-tier values (never `'best'`/`'miss'`). To see the new tiers live, either analyze a fresh game, or re-trigger analysis for an existing one if the app supports that (check `apps/api/src/services/analysis.ts` / the games re-analyze flow). If there's no re-analyze path, a freshly-imported game is the simplest way to get live data.

- [ ] **Step 3: Check desktop (MoveExplorer)**

Open a session with an analyzed game at a browser width ≥1080px. Confirm:
- Moves with `cpLoss === 0` show a green star badge.
- At least one mistake/blunder-range move from a winning position (may need a specific game to find one — a game with a large swing back from a big advantage) shows the plum/maroon `✕` miss badge, distinct from the red `??` blunder badge.
- The current-move highlight (clicking a move) still shows correctly with `--accent-contrast` text over the quality badge's own color untouched.
- "Show notes" does not show a "better was" line for a best-tier move.

- [ ] **Step 4: Check mobile (MoveStrip)**

Resize the browser below 768px (or use device emulation). Confirm the same badges appear on the horizontal strip, sized down, and that the badge lands on the *correct* chip (this is the ply-offset detail from Task 8 — if a badge is visibly one square off from where you'd expect, that's the `ply + 1` conversion being wrong).

- [ ] **Step 5: Report findings**

If everything looks right, this plan is complete. If something looks wrong, do NOT silently patch it as a one-off fix without understanding why — trace it back to which task's CSS/logic is responsible (the constraints section at the top of this plan lists the specificity/ply-offset traps most likely to bite) and fix it there.
