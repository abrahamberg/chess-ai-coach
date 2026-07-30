# Move Quality Threshold Retuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `classify.ts`'s flat centipawn-loss ladder with a win-probability (Expected-Points-loss) ladder, upgrade the `miss` tier from an approximation to true multi-PV detection, and add a `hangsPiece` data signal for future coaching use.

**Architecture:** All changes live in `packages/chess-analysis/src/classify.ts` and `critical-moments.ts` (pure functions, no I/O), plus a one-field addition to the shared Zod schema that the frontend already parses API responses through. No engine/infra changes — the engine service already returns 2 lines (`MultiPV=2` default) per position for full-game analysis, so true multi-PV miss detection needs zero new engine calls.

**Tech Stack:** TypeScript, Vitest, chess.js (already a `classify.ts` dependency), Zod.

## Global Constraints

- EP-loss band boundaries (inclusive lower bound), from `docs/superpowers/specs/2026-07-30-move-quality-threshold-retuning-design.md`: `good` `0 < epLoss < 0.05`; `interesting` `0.05 ≤ epLoss < 0.10`; `dubious` `0.10 ≤ epLoss < 0.20`; `mistake` `0.20 ≤ epLoss < 0.30`; `blunder` `epLoss ≥ 0.30`.
- `best` stays gated by the exact integer check `cpLoss === 0`, not by `epLoss` — never change this to an EP-based/epsilon comparison.
- Win-probability conversion: `expectedPoints(cp) = 1 / (1 + Math.exp(-0.00368208 * cp))`.
- True multi-PV miss: gap threshold is `MISS_GAP_CP = 300` (raw cp, mover-perspective, NOT EP — EP saturates near the extremes, which is exactly the case this signal must still catch).
- `isMiss` must be `false` whenever the move delivered mate (`moveSan` ends with `'#'`), regardless of the multi-PV gap.
- `hangsPiece` is new data on `ClassifiedMove`/`ClassifiedMoveDto` — it must never be read by `qualityFor` or by anything in `critical-moments.ts`. It exists only for a future spec.
- No tier is added or removed — still exactly the 8 `MOVE_QUALITIES` (`brilliant/best/good/interesting/dubious/mistake/miss/blunder`).
- No backfill/migration for already-analyzed games — `classifiedMoves` are computed once at analysis time and persisted; existing games keep their old tiers until re-analyzed. Do not add migration code.
- Do not touch `turningPointMoments` or `TURNING_POINT_THRESHOLD_CP` in `critical-moments.ts` — out of scope for this plan.
- Do not touch `packages/shared/src/coaching-plan.ts`'s `MomentKindSchema` or the prompt template in `packages/prompts/src/analysis-planner.ts` — both still legitimately reference `'missed_chance'` as part of the coaching-plan LLM's own output vocabulary, independent of the internal candidate-detection rule being removed here.

---

### Task 1: Add `hangsPiece` to the shared `ClassifiedMove` schema

**Files:**
- Modify: `packages/shared/src/analysis.ts`
- Test: `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Produces: `ClassifiedMoveSchema` now requires a `hangsPiece: boolean` field; `ClassifiedMoveDto` type gains `hangsPiece: boolean`.

This field must exist before Task 4 wires the domain-side `ClassifiedMove` interface to include it — the frontend (`apps/web/src/features/session/SessionPage.tsx`) parses `/api/games/:id` responses through `ClassifiedMoveSchema` (imported from `@chess-coach/shared`), and Zod's `z.object()` silently strips any field not declared in the schema. Without this task, a correctly-computed `hangsPiece` value would compute fine end-to-end on the backend but vanish before it ever reaches the frontend.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/schemas.test.ts`, find the existing `describe('ClassifiedMoveSchema', ...)` block (around line 64). Update its `validMove` fixture to include the new field, and add a test that a move without it is rejected:

```ts
describe('ClassifiedMoveSchema', () => {
  const validMove = {
    ply: 4,
    moveSan: 'Qxf7#',
    mover: 'white',
    isUserMove: true,
    cpLoss: 0,
    quality: 'brilliant',
    bestLineSan: ['Qxf7#'],
    evalAfterCp: 1000,
    hangsPiece: false
  };
  test('accepts a valid classified move', () => {
    expect(ClassifiedMoveSchema.safeParse(validMove).success).toBe(true);
  });
  test('accepts every MOVE_QUALITIES tier', () => {
    for (const quality of ['brilliant', 'best', 'good', 'interesting', 'dubious', 'mistake', 'miss', 'blunder']) {
      expect(ClassifiedMoveSchema.safeParse({ ...validMove, quality }).success).toBe(true);
    }
  });
  test('rejects an unknown quality tier (e.g. the old "inaccuracy" name)', () => {
    expect(ClassifiedMoveSchema.safeParse({ ...validMove, quality: 'inaccuracy' }).success).toBe(false);
  });
  test('rejects a move missing hangsPiece', () => {
    const { hangsPiece, ...withoutHangsPiece } = validMove;
    expect(ClassifiedMoveSchema.safeParse(withoutHangsPiece).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npm test --workspace packages/shared -- schemas.test.ts`
Expected: the new `rejects a move missing hangsPiece` test FAILS (the schema currently accepts a move without `hangsPiece` since the field doesn't exist yet, so `safeParse` succeeds when the test expects `false`).

- [ ] **Step 3: Add the field to the schema**

In `packages/shared/src/analysis.ts`, edit `ClassifiedMoveSchema`:

```ts
export const ClassifiedMoveSchema = z.object({
  ply: z.number().int().nonnegative(),
  moveSan: z.string(),
  mover: z.enum(['white', 'black']),
  isUserMove: z.boolean(),
  cpLoss: z.number().int().nonnegative(),
  quality: MoveQualitySchema,
  bestLineSan: z.array(z.string()),
  evalAfterCp: z.number().int(),
  hangsPiece: z.boolean()
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace packages/shared -- schemas.test.ts`
Expected: all `ClassifiedMoveSchema` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/analysis.ts packages/shared/src/schemas.test.ts
git commit -m "feat: add hangsPiece to ClassifiedMoveSchema"
```

---

### Task 2: Win-probability conversion function

**Files:**
- Modify: `packages/chess-analysis/src/classify.ts`
- Test: `packages/chess-analysis/src/classify.test.ts`

**Interfaces:**
- Produces: `export function expectedPoints(cp: number): number` — converts a mover-perspective centipawn score to that mover's expected points (0–1).

This is a standalone pure function, unused by the rest of the file until Task 4 wires it in — that's fine, it's fully testable in isolation.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `packages/chess-analysis/src/classify.test.ts` (anywhere at the top level, e.g. right after the imports/fixtures, before `describe('classifyMoves', ...)`):

```ts
describe('expectedPoints', () => {
  test('cp=0 is exactly 0.5 (a coin flip)', () => {
    expect(expectedPoints(0)).toBeCloseTo(0.5, 10);
  });

  test('is symmetric around 0', () => {
    expect(expectedPoints(-200)).toBeCloseTo(1 - expectedPoints(200), 10);
  });

  test('is monotonically increasing', () => {
    expect(expectedPoints(-100)).toBeLessThan(expectedPoints(0));
    expect(expectedPoints(0)).toBeLessThan(expectedPoints(100));
    expect(expectedPoints(100)).toBeLessThan(expectedPoints(500));
  });

  test('saturates toward 1 for a large positive score (e.g. a clamped mate score)', () => {
    expect(expectedPoints(1000)).toBeGreaterThan(0.97);
    expect(expectedPoints(1000)).toBeLessThan(1);
  });

  test('saturates toward 0 for a large negative score', () => {
    expect(expectedPoints(-1000)).toBeLessThan(0.03);
    expect(expectedPoints(-1000)).toBeGreaterThan(0);
  });
});
```

Update the test file's import line to include `expectedPoints`:

```ts
import { classifyMoves, expectedPoints, isSoundQuality } from './classify.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace packages/chess-analysis -- classify.test.ts`
Expected: FAIL with "expectedPoints is not a function" (or a TypeScript error that it doesn't exist).

- [ ] **Step 3: Implement `expectedPoints`**

In `packages/chess-analysis/src/classify.ts`, add this function near the other pure conversion helpers (e.g. right after `toMoverPerspective`):

```ts
/** Converts a mover-perspective centipawn score to that mover's expected
 * points (0-1) via the standard logistic win-probability curve (the same
 * conversion chess.com/Lichess-adjacent tooling uses). Symmetric around
 * cp=0 (0.5) and monotonic; mate scores arrive pre-clamped to +-MATE_CP by
 * whitePerspectiveCp/mateToCp, so they saturate near 0/1 rather than
 * exploding. */
export function expectedPoints(cp: number): number {
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace packages/chess-analysis -- classify.test.ts`
Expected: all 5 new `expectedPoints` tests PASS (other tests in the file are unaffected — this task doesn't touch `qualityFor` or `classifyMove` yet).

- [ ] **Step 5: Commit**

```bash
git add packages/chess-analysis/src/classify.ts packages/chess-analysis/src/classify.test.ts
git commit -m "feat: add expectedPoints win-probability conversion"
```

---

### Task 3: `hangsPiece` heuristic

**Files:**
- Modify: `packages/chess-analysis/src/classify.ts`
- Test: `packages/chess-analysis/src/classify.test.ts`

**Interfaces:**
- Produces: `export function hangsPiece(fenBefore: string, moveSan: string): boolean`.

Standalone function, mirroring the existing `isSacrifice`'s shape and one-ply-deep limitation, but simpler: no equal-or-lesser-attacker-value comparison, and captures are NOT excluded (unlike `isSacrifice`, which explicitly excludes them). Not yet wired into `ClassifiedMove` — that's Task 4.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `packages/chess-analysis/src/classify.test.ts` (near the `expectedPoints` block from Task 2):

```ts
describe('hangsPiece', () => {
  test('a non-capture move onto an attacked, undefended square hangs the piece', () => {
    // White bishop c4-e6: e6 is attacked by black pawns d7/f7, and no white
    // piece defends it.
    const beforeFen = '4k3/3p1p2/8/8/2B5/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Be6')).toBe(true);
  });

  test('a move onto an attacked square that a friendly piece defends does not hang', () => {
    // Same bishop move, but a white rook on e1 defends e6 down the open e-file.
    const beforeFen = '4k3/3p1p2/8/8/2B5/8/8/4RK2 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Be6')).toBe(false);
  });

  test('a move onto an unattacked square does not hang', () => {
    const beforeFen = '4k3/8/8/8/2B5/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Be6')).toBe(false);
  });

  test('a pawn move is never flagged, even onto an attacked, undefended square', () => {
    // White pawn d4-d5: a black knight on b6 attacks d5, nothing defends it,
    // but pawn moves are excluded regardless.
    const beforeFen = '4k3/8/1n6/8/3P4/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'd5')).toBe(false);
  });

  test('a capture that leaves the capturing piece hanging still counts (unlike isSacrifice)', () => {
    // Bxd7: bishop captures a pawn, landing on a square the black king
    // attacks, with no white defender.
    const beforeFen = '4k3/3p4/8/8/2B5/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Bxd7')).toBe(true);
  });

  test('an illegal move string returns false rather than throwing', () => {
    const beforeFen = '4k3/8/8/8/2B5/8/8/4K3 w - - 0 1';
    expect(hangsPiece(beforeFen, 'Zz9')).toBe(false);
  });
});
```

Update the import line again:

```ts
import { classifyMoves, expectedPoints, hangsPiece, isSoundQuality } from './classify.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace packages/chess-analysis -- classify.test.ts`
Expected: FAIL with "hangsPiece is not a function".

- [ ] **Step 3: Implement `hangsPiece`**

In `packages/chess-analysis/src/classify.ts`, add this function right after `isSacrifice`:

```ts
/** Best-effort "left a piece hanging" signal: true when the piece that just
 * moved lands on a square the opponent attacks with nothing of the mover's
 * own defending it. Simpler than isSacrifice -- no equal-or-lesser-attacker
 * comparison, no capture exclusion (a bad recapture that hangs the
 * recapturing piece still counts) -- and, like isSacrifice, only looks one
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace packages/chess-analysis -- classify.test.ts`
Expected: all 6 new `hangsPiece` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chess-analysis/src/classify.ts packages/chess-analysis/src/classify.test.ts
git commit -m "feat: add hangsPiece heuristic"
```

---

### Task 4: EP-based ladder, true multi-PV miss, and wiring

**Files:**
- Modify: `packages/chess-analysis/src/classify.ts`
- Test: `packages/chess-analysis/src/classify.test.ts`

**Interfaces:**
- Consumes: `expectedPoints` (Task 2), `hangsPiece` (Task 3), `hangsPiece: boolean` on `ClassifiedMoveSchema` (Task 1, backend-side round trip).
- Produces: `qualityFor(cpLoss: number, epLoss: number, isSacrifice = false, isMiss = false): MoveQuality` (signature change — was `qualityFor(cpLoss, isSacrifice, bestCpBeforeMoverPerspective)`); `ClassifiedMove` interface gains `hangsPiece: boolean`; `classifyMove`/`classifyMoves` compute and surface it.

This is the task where the actual classification algorithm changes. It has three internal TDD cycles (ladder, miss wiring, hangsPiece wiring) sharing one final commit, since `qualityFor`'s signature change and `classifyMove`'s call site must land together to keep the file compiling.

**Cycle A — the EP-based ladder**

- [ ] **Step 1: Write the failing tests**

Add a new `describe('qualityFor', ...)` block to `packages/chess-analysis/src/classify.test.ts`:

```ts
describe('qualityFor', () => {
  test('cpLoss 0 is always best, regardless of epLoss', () => {
    expect(qualityFor(0, 0)).toBe('best');
  });

  test('epLoss just below the interesting boundary (0.05) is good', () => {
    expect(qualityFor(50, 0.049)).toBe('good');
  });

  test('epLoss at the interesting boundary (0.05) is interesting', () => {
    expect(qualityFor(50, 0.05)).toBe('interesting');
  });

  test('epLoss just below the dubious boundary (0.10) stays interesting', () => {
    expect(qualityFor(100, 0.099)).toBe('interesting');
  });

  test('epLoss at the dubious boundary (0.10) is dubious', () => {
    expect(qualityFor(100, 0.1)).toBe('dubious');
  });

  test('epLoss at the mistake boundary (0.20) is mistake', () => {
    expect(qualityFor(200, 0.2)).toBe('mistake');
  });

  test('epLoss at the blunder boundary (0.30) is blunder', () => {
    expect(qualityFor(300, 0.3)).toBe('blunder');
  });

  test('epLoss well past the blunder boundary is still blunder', () => {
    expect(qualityFor(900, 0.95)).toBe('blunder');
  });

  test('a sacrifice with low epLoss is brilliant', () => {
    expect(qualityFor(10, 0.01, true)).toBe('brilliant');
  });

  test('a sacrifice with high epLoss is not brilliant -- the ladder wins', () => {
    expect(qualityFor(300, 0.25, true)).toBe('mistake');
  });

  test('isMiss overrides the ladder result entirely, even at blunder-range epLoss', () => {
    expect(qualityFor(900, 0.95, false, true)).toBe('miss');
  });

  test('isMiss overrides even a would-be brilliant sacrifice', () => {
    expect(qualityFor(10, 0.01, true, true)).toBe('miss');
  });

  test('cpLoss 1 (not exactly 0) with tiny epLoss is good, not best', () => {
    expect(qualityFor(1, 0.001)).toBe('good');
  });
});
```

Update the import line: `import { classifyMoves, expectedPoints, hangsPiece, isSoundQuality, qualityFor } from './classify.js';`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace packages/chess-analysis -- classify.test.ts`
Expected: FAIL — `qualityFor` currently takes `(cpLoss, isSacrifice, bestCpBeforeMoverPerspective)`, so calling it with an `epLoss` second argument produces wrong results/type errors for most of these cases.

- [ ] **Step 3: Rewrite `qualityFor` and its constants**

In `packages/chess-analysis/src/classify.ts`, replace the existing threshold constants block:

```ts
const MATE_CP = 1000;
const INTERESTING_THRESHOLD_CP = 20;
const DUBIOUS_THRESHOLD_CP = 50;
const MISTAKE_THRESHOLD_CP = 100;
const BLUNDER_THRESHOLD_CP = 300;
const WINNING_POSITION_CP = 300;
```

with:

```ts
const MATE_CP = 1000;
const INTERESTING_EP = 0.05;
const DUBIOUS_EP = 0.1;
const MISTAKE_EP = 0.2;
const BLUNDER_EP = 0.3;
const MISS_GAP_CP = 300;
```

Replace the existing `qualityFor` function (and its doc comment) entirely with:

```ts
/**
 * Buckets a move into a quality tier using Expected-Points-loss (`epLoss`,
 * 0-1, via `expectedPoints`) as the primary signal, plus two overrides:
 * `isSacrifice` (unchanged detection, gated to low epLoss) and `isMiss`
 * (true multi-PV "you had a much better line and didn't play it" signal,
 * which overrides the ladder result entirely -- see `classifyMove`).
 *
 * `cpLoss === 0` is the one exception that stays cp-based rather than
 * EP-based: it is the exact "played the engine's own top choice" case, and
 * using raw cp for it sidesteps any floating-point-equality concerns from
 * the EP conversion.
 */
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

- [ ] **Step 4: Run the tests to verify Cycle A passes**

Run: `npm test --workspace packages/chess-analysis -- classify.test.ts`
Expected: the 13 new `qualityFor` tests PASS. Other tests in the file will still fail at this point (`classifyMove` hasn't been updated to call the new signature yet) — that's expected, continue to Cycle B before running the full suite again.

**Cycle B — true multi-PV miss, wired into `classifyMove`**

- [ ] **Step 5: Update the old miss-tier tests that no longer apply**

The old `miss` tier used a `bestCp >= 300` approximation that this task removes entirely. In `packages/chess-analysis/src/classify.test.ts`, DELETE these five tests (they test the removed mechanism):
- `'a mistake-range cpLoss from an already-winning position (bestCp >= 300) classifies as miss'`
- `'the same mistake-range cpLoss stays mistake when the position was NOT already winning (bestCp just below 300)'`
- `'a blunder-range cpLoss from an already-winning position classifies as miss, not blunder'`
- `'missing an available mate reclassifies a would-be blunder as miss'`

Also DELETE these two tests — their EP-loss values under the new ladder no longer match a hand-picked cp threshold from the old system, and their scenarios are superseded by the `qualityFor` boundary tests added in Cycle A:
- `'cpLoss 75 classifies as dubious'`
- `'cpLoss 30 (below dubious, above the near-best band) classifies as interesting'`
- `'cpLoss 150 classifies as mistake'`
- `'cpLoss 400 classifies as blunder'`

MODIFY the `'clamps cpLoss at 1000 even when the raw gap is larger'` test — it uses a single-line eval fixture (no multi-PV data), so under the new true-miss logic it can no longer be `'miss'` (no `lines[1]` to compare against). Change its expected quality:

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
  expect(whiteMove?.quality).toBe('blunder');
});
```

- [ ] **Step 6: Add new integration tests for the wiring**

Add these tests to the `describe('classifyMoves', ...)` block (they need `EngineLine`, so add `import type { EngineEval, EngineLine } from '@chess-coach/shared';` if not already present at the top of the file, and a small local helper below the existing `evalAt`):

```ts
function line(moveSan: string, cp: number | null, mateIn: number | null = null): EngineLine {
  return { moveUci: 'e2e4', moveSan, cp, mateIn };
}

function evalWithLines(fen: string, lines: EngineLine[]): EngineEval {
  return { ply: 0, fen, depth: 18, lines };
}
```

```ts
test('the EP-loss ladder is wired end-to-end through classifyMoves (not just qualityFor in isolation)', () => {
  const game = twoPlyGame();
  // bestCp=0, playedCp=-500 (mover perspective) -> epLoss = expectedPoints(0)
  // - expectedPoints(-500) ~= 0.5 - 0.137 ~= 0.363, past the 0.30 blunder
  // boundary.
  const evals = [evalAt(START_FEN, 0), evalAt(AFTER_E4_FEN, -500), evalAt(AFTER_E4_E5_FEN, -500)];

  const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

  expect(whiteMove?.cpLoss).toBe(500);
  expect(whiteMove?.quality).toBe('blunder');
});

test('a large multiPv gap overrides to miss even when the move played was still nearly winning (EP saturation)', () => {
  const game = twoPlyGame();
  // Best line is mate-in-5 (+1000cp); the move actually played (e4) leaves a
  // position evaluated at only +700 -- still winning big, so naive epLoss
  // (expectedPoints(1000) - expectedPoints(700) ~= 0.046) would read as
  // 'good'. The 300cp raw gap to the second-best line is what catches this.
  const evals = [
    evalWithLines(START_FEN, [line('Qxf7', null, 5), line('e4', 700)]),
    evalAt(AFTER_E4_FEN, 700),
    evalAt(AFTER_E4_E5_FEN, 700)
  ];

  const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

  expect(whiteMove?.quality).toBe('miss');
});

test('does not flag miss when the player found the engine-best move, regardless of the gap to the second line', () => {
  const game = twoPlyGame();
  const evals = [
    evalWithLines(START_FEN, [line('e4', 900), line('Nf3', 100)]),
    evalAt(AFTER_E4_FEN, 900),
    evalAt(AFTER_E4_E5_FEN, 900)
  ];

  const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

  expect(whiteMove?.cpLoss).toBe(0);
  expect(whiteMove?.quality).toBe('best');
});

test('does not flag miss when the multiPv gap is below the 300cp threshold', () => {
  const game = twoPlyGame();
  const evals = [
    evalWithLines(START_FEN, [line('Nxf7', 400), line('e4', 200)]),
    evalAt(AFTER_E4_FEN, 200),
    evalAt(AFTER_E4_E5_FEN, 200)
  ];

  const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

  expect(whiteMove?.cpLoss).toBe(200);
  expect(whiteMove?.quality).toBe('dubious');
});

test('does not flag miss when evalBefore has only one line (no multiPv data)', () => {
  const game = twoPlyGame();
  const evals = [evalAt(START_FEN, 900), evalAt(AFTER_E4_FEN, 200), evalAt(AFTER_E4_E5_FEN, 200)];

  const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

  expect(whiteMove?.cpLoss).toBe(700);
  expect(whiteMove?.quality).toBe('mistake');
});

test('a move ending in # (delivered mate) is never classified as miss, even with a large multiPv gap to a different top line', () => {
  const game: ParsedGame = {
    headers: {},
    positions: [
      { ply: 0, fen: START_FEN, moveSan: null, moveUci: null, mover: null },
      { ply: 1, fen: AFTER_E4_FEN, moveSan: 'e4#', moveUci: 'e2e4', mover: 'white' }
    ]
  };
  const evals = [evalWithLines(START_FEN, [line('Qxf7', null, 1), line('e4', 50)]), evalAt(AFTER_E4_FEN, 1000)];

  const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

  expect(whiteMove?.cpLoss).toBe(0);
  expect(whiteMove?.quality).toBe('best');
});
```

- [ ] **Step 7: Run the tests to verify Cycle B's new tests fail correctly**

Run: `npm test --workspace packages/chess-analysis -- classify.test.ts`
Expected: FAIL — `classifyMove` doesn't compute `epLoss` or `isMiss` yet, so it can't be calling the new `qualityFor` signature correctly (likely a TypeScript compile error at this point, since `qualityFor`'s old 3-arg call site in `classifyMove` no longer type-checks against the new 4-arg signature).

- [ ] **Step 8: Wire `epLoss` and `isMiss` into `classifyMove`**

**Cycle C — `hangsPiece` wiring**

Do this together with Cycle B's implementation step since both touch `classifyMove`'s body and the `ClassifiedMove` interface in the same edit. In `packages/chess-analysis/src/classify.ts`:

Update the `ClassifiedMove` interface:

```ts
export interface ClassifiedMove {
  ply: number;
  moveSan: string;
  mover: 'white' | 'black';
  isUserMove: boolean;
  cpLoss: number;
  quality: MoveQuality;
  bestLineSan: string[];
  evalAfterCp: number;
  hangsPiece: boolean;
}
```

Replace the `classifyMove` function body:

```ts
function classifyMove(
  position: ParsedGame['positions'][number],
  evalBefore: EngineEval | undefined,
  evalAfter: EngineEval | undefined,
  userColor: 'white' | 'black',
  fenBefore: string | undefined
): ClassifiedMove {
  const mover = position.mover ?? 'white';
  const bestCp = toMoverPerspective(whitePerspectiveCp(bestLine(evalBefore)), mover);
  const deliveredMate = position.moveSan?.endsWith('#') ?? false;
  const playedCp = deliveredMate ? bestCp : toMoverPerspective(whitePerspectiveCp(bestLine(evalAfter)), mover);
  const cpLoss = clamp(bestCp - playedCp, 0, MATE_CP);
  const epLoss = clamp(expectedPoints(bestCp) - expectedPoints(playedCp), 0, 1);
  const sacrifice =
    fenBefore !== undefined && position.moveSan !== null && isSacrifice(fenBefore, position.moveSan);
  const hangs = fenBefore !== undefined && position.moveSan !== null && hangsPiece(fenBefore, position.moveSan);
  const isMiss = computeIsMiss(evalBefore, position.moveSan, mover, bestCp, deliveredMate);

  return {
    ply: position.ply,
    moveSan: position.moveSan ?? '',
    mover,
    isUserMove: mover === userColor,
    cpLoss,
    quality: qualityFor(cpLoss, epLoss, sacrifice, isMiss),
    bestLineSan: bestLineSan(evalBefore),
    evalAfterCp: whitePerspectiveCp(bestLine(evalAfter)),
    hangsPiece: hangs
  };
}

/** True multi-PV "miss": the pre-move position had a much better line
 * (>=MISS_GAP_CP better, mover perspective) than the one actually played,
 * and the mover didn't deliver mate instead (which would otherwise
 * spuriously trigger this via the mate-vs-non-mate cp gap, even though
 * delivering mate is definitionally the best possible outcome). */
function computeIsMiss(
  evalBefore: EngineEval | undefined,
  playedSan: string | null,
  mover: 'white' | 'black',
  bestCp: number,
  deliveredMate: boolean
): boolean {
  if (deliveredMate) return false;
  const lines = evalBefore?.lines ?? [];
  const bestMoveSan = lines[0]?.moveSan;
  const secondLine = lines[1];
  if (bestMoveSan === undefined || secondLine === undefined || playedSan === bestMoveSan) return false;
  const secondBestCp = toMoverPerspective(whitePerspectiveCp(secondLine), mover);
  return bestCp - secondBestCp >= MISS_GAP_CP;
}
```

- [ ] **Step 9: Add the `hangsPiece` field-surfacing integration test**

Add to the `describe('classifyMoves', ...)` block:

```ts
test('classifyMoves surfaces hangsPiece on the returned move', () => {
  const beforeFen = '4k3/3p1p2/8/8/2B5/8/8/4K3 w - - 0 1';
  const afterFen = '4k3/3p1p2/4B3/8/8/8/8/4K3 b - - 1 1';
  const game: ParsedGame = {
    headers: {},
    positions: [
      { ply: 0, fen: beforeFen, moveSan: null, moveUci: null, mover: null },
      { ply: 1, fen: afterFen, moveSan: 'Be6', moveUci: 'c4e6', mover: 'white' }
    ]
  };
  const evals = [evalAt(beforeFen, 0), evalAt(afterFen, 0)];

  const whiteMove = classifyMoves(game, evals, 'white').find((move) => move.ply === 1);

  expect(whiteMove?.hangsPiece).toBe(true);
});
```

- [ ] **Step 10: Run the full test file and verify everything passes**

Run: `npm test --workspace packages/chess-analysis -- classify.test.ts`
Expected: every test in the file PASSES — Cycle A's `qualityFor` tests, Cycle B's miss-wiring tests, Cycle C's `hangsPiece` test, and every unmodified pre-existing test (perspective-flip, delivered-checkmate, isUserMove, empty-array, evalAfterCp-mapping, brilliant/best-vs-good sacrifice tests, `isSoundQuality`).

- [ ] **Step 11: Typecheck the package**

Run: `npx tsc -b packages/chess-analysis`
Expected: no errors. (`bestCpBeforeMoverPerspective` no longer exists anywhere; confirm no other file in the repo still passes it — `grep -rn "bestCpBeforeMoverPerspective" --include=*.ts .` should return nothing outside this plan/spec's own prose.)

- [ ] **Step 12: Commit**

```bash
git add packages/chess-analysis/src/classify.ts packages/chess-analysis/src/classify.test.ts
git commit -m "feat: EP-loss move-quality ladder with true multi-PV miss detection"
```

---

### Task 5: Remove the superseded `missed_chance` candidate-moment rule

**Files:**
- Modify: `packages/chess-analysis/src/critical-moments.ts`
- Modify: `packages/chess-analysis/src/critical-moments.test.ts`
- Modify: `docs/plan.md`

**Interfaces:**
- Consumes: nothing new from Task 4 (this task only removes code — `classify.ts`'s `miss` tier already fully replaces this rule's purpose).
- Produces: `CandidateMomentKind` narrows to `'user_mistake' | 'turning_point'`; `findCandidateMoments`'s signature is unchanged (`(moves: ClassifiedMove[], evals: EngineEval[]): CandidateMoment[]`) — `evals` is still needed by `turningPointMoments`.

This rule (`missedChanceMoments`) computed the exact same signal Task 4 gave to `classify.ts`'s `miss` tier (best-vs-second-best line gap, same 300cp magnitude), but only fired on moves `isSoundQuality` already excludes `miss` from. It is now unreachable dead code: any move it would have flagged is already tagged `miss` by `classifyMove` and filtered out by `isSoundQuality` before `missedChanceMoments` would see it.

- [ ] **Step 1: Delete the superseded tests**

In `packages/chess-analysis/src/critical-moments.test.ts`, delete these seven tests (all inside `describe('findCandidateMoments', ...)`):
- `'flags a missed_chance when the user plays a good move but a >=300cp better line existed'`
- `'does not flag missed_chance when the user actually played the top engine line'`
- `'does not flag missed_chance when the multiPv gap is below 300cp'`
- `'does not flag missed_chance when only one multiPv line is available'`
- `'does not flag missed_chance for a non-good quality move even with a big gap'`
- `'does not flag missed_chance for opponent moves'`
- `'accounts for the mover perspective flip when computing the missed_chance gap'`

Rename `'dedups by ply, preferring user_mistake over missed_chance over turning_point'` to `'dedups by ply, preferring user_mistake over turning_point'` — its body doesn't need to change (it never constructed a missed_chance scenario; it tests `user_mistake` winning over `turning_point` on the same ply, which is unaffected).

Leave every other test in the file unchanged — in particular, `'results are sorted by ply regardless of which rule produced them'` still passes without modification: the ply-2 move in that fixture crosses `turningPointMoments`' own eval-zone boundary independently, so it still produces a moment (just via `turning_point` rather than the removed `missed_chance`), and the test only asserts on plies, not kinds.

- [ ] **Step 2: Run the tests to verify the remaining ones still pass and the deleted scenarios are gone**

Run: `npm test --workspace packages/chess-analysis -- critical-moments.test.ts`
Expected: all remaining tests PASS (this step is a checkpoint before the source deletion, confirming the test file itself is internally consistent).

- [ ] **Step 3: Remove the rule from `critical-moments.ts`**

In `packages/chess-analysis/src/critical-moments.ts`:

Remove the constant:
```ts
const MISSED_CHANCE_GAP_CP = 300;
```

Change the type and priority map:
```ts
export type CandidateMomentKind = 'user_mistake' | 'turning_point';
```
```ts
const KIND_PRIORITY: Record<CandidateMomentKind, number> = {
  user_mistake: 2,
  turning_point: 1
};
```

Update `findCandidateMoments`'s doc comment and body — remove the `missedChanceMoments` call and the multiPv-gap sentence:

```ts
/**
 * Finds candidate critical-moment plies for the analysis-planner LLM to
 * prioritize (specs.md §4.2.3 rules a and c; rule b's former multiPv
 * line-gap detection was folded into classify.ts's `miss` quality tier as
 * of the 2026-07-30 threshold-retuning spec -- any move it would have
 * flagged is already tagged `miss` and reaches the planner via rule a
 * instead. Rule d, planner-selected instructive moments with no eval swing,
 * is the LLM's job, not this pure function's).
 *
 * `evals[i]` is the engine evaluation of the position at `moves[i - 1]`'s
 * "before" state (index-aligned the same way as `classifyMoves`), needed
 * here for `turningPointMoments`'s starting-position eval.
 *
 * Not capped -- the planner prioritizes among however many are found. One
 * moment per ply: when multiple rules fire on the same ply, user_mistake
 * wins over turning_point.
 */
export function findCandidateMoments(moves: ClassifiedMove[], evals: EngineEval[]): CandidateMoment[] {
  const byPly = new Map<number, CandidateMoment>();
  addAll(byPly, userMistakeMoments(moves));
  addAll(byPly, turningPointMoments(moves, evals));
  return [...byPly.values()].sort((a, b) => a.ply - b.ply);
}
```

Remove the `missedChanceMoments`, `missedChanceGapCp`, and `lineCpForMover` functions entirely (they are no longer called by anything):

```ts
/** Rule (b): user's sound moves (not dubious/mistake/blunder/miss) where a
 * >=300cp better line existed per multiPv but wasn't played. */
function missedChanceMoments(moves: ClassifiedMove[], evals: EngineEval[]): CandidateMoment[] {
  const moments: CandidateMoment[] = [];
  for (const move of moves) {
    if (!move.isUserMove || !isSoundQuality(move.quality)) continue;
    const gapCp = missedChanceGapCp(evals[move.ply - 1], move.mover, move.moveSan);
    if (gapCp >= MISSED_CHANCE_GAP_CP) moments.push({ ply: move.ply, kind: 'missed_chance', cpLoss: gapCp });
  }
  return moments;
}

function missedChanceGapCp(
  evalBefore: EngineEval | undefined,
  mover: 'white' | 'black',
  playedSan: string
): number {
  const [best, secondBest] = evalBefore?.lines ?? [];
  if (!best || !secondBest || best.moveSan === playedSan) return 0;
  return lineCpForMover(best, mover) - lineCpForMover(secondBest, mover);
}

function lineCpForMover(line: EngineLine, mover: 'white' | 'black'): number {
  return toMoverPerspective(whitePerspectiveCp(line), mover);
}
```

Check the top-of-file imports — `EngineLine` was only used by `lineCpForMover`; after removing it, confirm whether `EngineLine` is still imported/used elsewhere in the file (it isn't, per the current file), and remove it from the `import type { EngineEval, EngineLine } from '@chess-coach/shared';` line, leaving `import type { EngineEval } from '@chess-coach/shared';`.

Also check whether `isSoundQuality` is still used elsewhere in the file after removing `missedChanceMoments` — it isn't (per the current file, `missedChanceMoments` was its only caller here), so remove it from the `import { isSoundQuality, toMoverPerspective, whitePerspectiveCp } from './classify.js';` line, leaving `import { toMoverPerspective, whitePerspectiveCp } from './classify.js';`.

- [ ] **Step 4: Run the tests again to verify everything still passes**

Run: `npm test --workspace packages/chess-analysis -- critical-moments.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Typecheck the package**

Run: `npx tsc -b packages/chess-analysis`
Expected: no errors, no unused-import warnings.

- [ ] **Step 6: Update `docs/plan.md`**

In `docs/plan.md`, find Task 1.3 (around line 145-147) and replace:

```markdown
- Produces: `findCandidateMoments(moves: ClassifiedMove[]): CandidateMoment[]`,
  `CandidateMoment = { ply: number; kind: 'user_mistake'|'missed_chance'|'turning_point'; cpLoss: number }`.
- Rules (specs §4.2.3): user mistakes/blunders; user `good` moves where a ≥300cp better alternative existed (missed_chance uses multiPv line gap); plies where white-perspective eval crosses ±150. No cap here (planner LLM prioritizes); sorted by ply; deduped by ply (priority: user_mistake > missed_chance > turning_point).
```

with:

```markdown
- Produces: `findCandidateMoments(moves: ClassifiedMove[]): CandidateMoment[]`,
  `CandidateMoment = { ply: number; kind: 'user_mistake'|'turning_point'; cpLoss: number }`.
- Rules (specs §4.2.3): user mistakes/blunders/misses; plies where white-perspective eval crosses ±150. No cap here (planner LLM prioritizes); sorted by ply; deduped by ply (priority: user_mistake > turning_point). (The former `missed_chance` rule — user `good` moves where a ≥300cp better multiPv line existed — was folded into `classify.ts`'s true multi-PV `miss` quality tier as of the 2026-07-30 threshold-retuning spec; any move it would have flagged is now already tagged `miss` and reaches the coaching plan via the `user_mistake` rule instead.)
```

- [ ] **Step 7: Commit**

```bash
git add packages/chess-analysis/src/critical-moments.ts packages/chess-analysis/src/critical-moments.test.ts docs/plan.md
git commit -m "refactor: remove missed_chance candidate-moment rule, superseded by classify.ts's true-miss tier"
```

---

## Final verification (not a task — run after Task 5)

- [ ] Run the full monorepo test suite: `npm test`. Expected: all tests pass (no regressions outside the files this plan touched).
- [ ] Run the full monorepo typecheck: `npx tsc -b`. Expected: no errors.
- [ ] Live verification: re-run analysis on a real imported game (via the running dev stack) and eyeball badge density on both `MoveExplorer` (desktop) and `MoveStrip` (mobile) against the pre-change density. This is a tuning change — the automated tests confirm the arithmetic is internally consistent, but only a real game's move list confirms it "feels right."
