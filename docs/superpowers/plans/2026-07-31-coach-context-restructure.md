# Coach context restructure — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coach agent's whole-transcript replay with episode-scoped context assembly (annotated PGN, per-move notes, a validated current-move block, an on-demand recall tool) so the model stops confusing/hallucinating positions as a session accumulates discussion of many moves.

**Architecture:** Every `session_messages` row is tagged with the `ply` that was current when it was written. A turn's replayed conversation becomes just the contiguous run of messages sharing the session's current `ply` (an "episode"), scanned in memory. Everything about moves *outside* the current episode collapses into one-line notes in a new `session_move_notes` table, either coach-authored (`record_move_note`) or auto-summarized when an episode closes without one. The request sent to the model grows from two cached system blocks to five: static instructions, per-session dynamic data, a static annotated-PGN block, a per-turn other-moves-summary block, and an uncached current-move block — each on its own Anthropic cache breakpoint except the last.

**Tech Stack:** Fastify + Kysely (Postgres) + AI SDK (`ai`, `@ai-sdk/anthropic`) + Zod, in the existing `apps/api`, `packages/prompts`, `packages/shared`, `packages/chess-analysis` layout. Vitest throughout; API-layer tests use Testcontainers Postgres (`apps/api/test/helpers/db.ts`).

## Global Constraints

- Reference spec: `docs/superpowers/specs/2026-07-31-coach-context-restructure-design.md` — every task below implements one numbered section of it.
- Layering is strict (`AGENTS.md`): SQL only in `apps/api/src/db/repositories/`; pure logic in `packages/chess-analysis` or an `apps/api/src/lib/` file; services own invariants; routes/tools are thin adapters.
- No `any`; narrow `unknown`. No bare `!` outside tests. Files target <200 lines, split by ~250.
- Prompt text lives only in `packages/prompts` and must match `docs/prompts.md` — every prompt-text change updates both.
- `session_messages` stays append-only — every change here is an *insert* with a new column value, never an update to an existing row.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit. Run `npm run lint && npm run typecheck && npm test` before considering any task done.
- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`), one logical change per commit.
- No new dependencies — everything here is buildable with what's already installed (`kysely`, `zod`, `ai`, `chess.js` via `@chess-coach/chess-analysis`).
- **Environment note: Testcontainers (Docker) is unavailable in this sandbox.** DB-backed tests (anything using `createTestDb()`) cannot actually be executed here — writing them is still required (TDD in spirit: write the test, then the implementation that satisfies it), but "run it to confirm it fails/passes" steps that need a real Postgres cannot be carried out. Report this honestly in the implementation report rather than claiming a run that didn't happen. Pure/unit tests with no DB dependency (episodes.test.ts, render.test.ts, episode-context.test.ts, tools.test.ts, coach-system.test.ts) are unaffected and must actually be run and shown passing.

---

### Task 1: Migration — `session_messages.ply`, `session_move_notes`, drop the unused digest columns

**Files:**
- Create: `apps/api/src/db/migrations/0006_episode_context.ts`
- Modify: `apps/api/src/db/schema.ts`

**Interfaces:**
- Produces: `SessionMessagesTable.ply: number | null`, a new `SessionMoveNotesTable` registered in `Database` as `sessionMoveNotes`, and the removal of `SessionsTable.contextDigest` / `.digestThroughMessageId` (confirmed via repo-wide grep to be read/written nowhere outside `schema.ts`).

- [ ] **Step 1: Write the migration**

```ts
import { sql, type Kysely } from 'kysely';

/**
 * Coach context restructure (docs/superpowers/specs/2026-07-31-coach-context-
 * restructure-design.md §1/§3/§6): tags every session_messages row with the
 * ply that was current when it was written, so a turn's replay can be
 * scoped to one contiguous "episode" instead of the whole transcript.
 * session_move_notes replaces the never-wired-up context_digest/
 * digest_through_message_id columns with per-move rolling notes.
 *
 * Backfill is intentionally crude (pre-launch, low session volume): every
 * existing message is tagged with its session's *current* current_ply,
 * collapsing all pre-migration history into one big episode. Worst case,
 * one old session's first post-migration turn replays more than strictly
 * necessary; it self-corrects from the next episode boundary onward.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE session_messages ADD COLUMN ply int`.execute(db);
  await sql`
    UPDATE session_messages sm
    SET ply = s.current_ply
    FROM sessions s
    WHERE sm.session_id = s.id AND sm.ply IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE session_move_notes (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id  uuid NOT NULL REFERENCES sessions(id),
      ply         int NOT NULL,
      note        text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (session_id, ply)
    )
  `.execute(db);

  await sql`ALTER TABLE sessions DROP COLUMN context_digest`.execute(db);
  await sql`ALTER TABLE sessions DROP COLUMN digest_through_message_id`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions ADD COLUMN context_digest text`.execute(db);
  await sql`ALTER TABLE sessions ADD COLUMN digest_through_message_id bigint`.execute(db);
  await sql`DROP TABLE session_move_notes`.execute(db);
  await sql`ALTER TABLE session_messages DROP COLUMN ply`.execute(db);
}
```

- [ ] **Step 2: Update the schema types**

In `apps/api/src/db/schema.ts`:

```ts
export interface SessionsTable {
  id: Generated<string>;
  gameId: string;
  userId: string;
  status: 'active' | 'completed' | 'paused_no_credits' | 'abandoned';
  currentPly: Generated<number>;
  threads: ColumnType<unknown, string | undefined, string>;
  debugSnapshot: ColumnType<unknown, string | null | undefined, string | null>;
  summary: string | null;
  homework: string | null;
  startedAt: Generated<Date>;
  endedAt: Date | null;
}

export interface SessionMessagesTable {
  id: Generated<string>;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: Jsonb<unknown>;
  ply: number | null;
  createdAt: Generated<Date>;
}

export interface SessionMoveNotesTable {
  id: Generated<string>;
  sessionId: string;
  ply: number;
  note: string;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}
```

(Remove the `contextDigest`/`digestThroughMessageId` lines from `SessionsTable`.) Add `sessionMoveNotes: SessionMoveNotesTable;` to the `Database` interface alongside the other tables.

- [ ] **Step 3: Verify the migration runs**

Run: `npm test -w apps/api -- session-messages` (any existing suite that calls `createTestDb()` will run every migration, including this one, against a throwaway Testcontainers Postgres). If nothing matches yet, run `npm run typecheck -w apps/api` to confirm the schema compiles, then proceed — Task 2's test exercises the new column directly.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/0006_episode_context.ts apps/api/src/db/schema.ts
git commit -m "feat: add session_messages.ply and session_move_notes, drop unused digest columns"
```

---

### Task 2: `session_messages` repository — carry `ply`

**Files:**
- Modify: `apps/api/src/db/repositories/session-messages.ts`
- Test: `apps/api/src/services/coach-agent.test.ts` (covered by Task 12's integration tests — this task's own verification is a quick standalone check below)

**Interfaces:**
- Produces: `SessionMessageRow.ply: number | null`; `insert(db, sessionId, role, content, ply?: number | null)`; new `listBySessionAndPly(db, sessionId, ply)`.
- Consumes: nothing new.

- [ ] **Step 1: Write a throwaway failing check**

Add a temporary test at the bottom of a scratch file (or run inline via `npx vitest run` against a small addition to `apps/api/src/db/repositories/session-messages.test.ts` — this repo has no dedicated test file yet, so create one):

```ts
// apps/api/src/db/repositories/session-messages.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../../test/helpers/db.js';
import * as usersRepo from './users.js';
import * as gamesRepo from './games.js';
import * as sessionsRepo from './sessions.js';
import * as sessionMessagesRepo from './session-messages.js';
import type { Database } from '../schema.js';

describe('session-messages repository', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedSession() {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: '1. e4 e5',
      source: 'paste',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    return sessionsRepo.insert(db, { gameId: game.id, userId: user.id });
  }

  test('insert() persists the given ply, defaulting to null when omitted', async () => {
    const session = await seedSession();
    const tagged = await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
    const untagged = await sessionMessagesRepo.insert(db, session.id, 'assistant', 'hi');

    expect(tagged.ply).toBe(0);
    expect(untagged.ply).toBeNull();
  });

  test('listBySessionAndPly returns only messages tagged with that ply, in insert order', async () => {
    const session = await seedSession();
    await sessionMessagesRepo.insert(db, session.id, 'user', 'a', 0);
    await sessionMessagesRepo.insert(db, session.id, 'assistant', 'b', 4);
    await sessionMessagesRepo.insert(db, session.id, 'user', 'c', 0);

    const messages = await sessionMessagesRepo.listBySessionAndPly(db, session.id, 0);

    expect(messages.map((m) => m.content)).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w apps/api -- session-messages.test`
Expected: FAIL — `insert` doesn't accept a 5th argument yet, `listBySessionAndPly` doesn't exist, `ply` isn't on the returned row type.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/db/repositories/session-messages.ts
import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export type SessionMessageRole = 'user' | 'assistant' | 'tool';

export interface SessionMessageRow {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: unknown;
  ply: number | null;
  createdAt: Date;
}

export function insert(
  db: Kysely<Database>,
  sessionId: string,
  role: SessionMessageRole,
  content: unknown,
  ply: number | null = null
): Promise<SessionMessageRow> {
  return db
    .insertInto('sessionMessages')
    .values({ sessionId, role, content: JSON.stringify(content), ply })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Append-only replay order (architecture §8.1 — never mutate, never reorder). */
export function listBySession(db: Kysely<Database>, sessionId: string): Promise<SessionMessageRow[]> {
  return db
    .selectFrom('sessionMessages')
    .selectAll()
    .where('sessionId', '=', sessionId)
    .orderBy('id', 'asc')
    .execute();
}

/** recall_move tool (design doc §4): the raw transcript for one specific
 * past episode, excluding whatever's currently open. */
export function listBySessionAndPly(
  db: Kysely<Database>,
  sessionId: string,
  ply: number
): Promise<SessionMessageRow[]> {
  return db
    .selectFrom('sessionMessages')
    .selectAll()
    .where('sessionId', '=', sessionId)
    .where('ply', '=', ply)
    .orderBy('id', 'asc')
    .execute();
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w apps/api -- session-messages.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/repositories/session-messages.ts apps/api/src/db/repositories/session-messages.test.ts
git commit -m "feat: tag session_messages rows with the ply current when they were written"
```

---

### Task 3: `session_move_notes` repository

**Files:**
- Create: `apps/api/src/db/repositories/session-move-notes.ts`
- Test: `apps/api/src/db/repositories/session-move-notes.test.ts`

**Interfaces:**
- Produces: `SessionMoveNoteRow`, `upsert(db, sessionId, ply, note)`, `findByPly(db, sessionId, ply)`, `listOtherPlies(db, sessionId, currentPly)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../../test/helpers/db.js';
import * as usersRepo from './users.js';
import * as gamesRepo from './games.js';
import * as sessionsRepo from './sessions.js';
import * as sessionMoveNotesRepo from './session-move-notes.js';
import type { Database } from '../schema.js';

describe('session-move-notes repository', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedSession() {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: '1. e4 e5',
      source: 'paste',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    return sessionsRepo.insert(db, { gameId: game.id, userId: user.id });
  }

  test('upsert() creates a note, then a second call for the same ply overwrites it (last write wins)', async () => {
    const session = await seedSession();
    await sessionMoveNotesRepo.upsert(db, session.id, 4, 'first draft');
    const updated = await sessionMoveNotesRepo.upsert(db, session.id, 4, 'final note');

    expect(updated.note).toBe('final note');
    const rows = await sessionMoveNotesRepo.listOtherPlies(db, session.id, -1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.note).toBe('final note');
  });

  test('findByPly returns undefined when nothing was ever recorded for that ply', async () => {
    const session = await seedSession();
    const row = await sessionMoveNotesRepo.findByPly(db, session.id, 99);
    expect(row).toBeUndefined();
  });

  test('listOtherPlies excludes the current ply and orders the rest ascending', async () => {
    const session = await seedSession();
    await sessionMoveNotesRepo.upsert(db, session.id, 8, 'later note');
    await sessionMoveNotesRepo.upsert(db, session.id, 4, 'earlier note');
    await sessionMoveNotesRepo.upsert(db, session.id, 12, 'current — excluded');

    const rows = await sessionMoveNotesRepo.listOtherPlies(db, session.id, 12);

    expect(rows.map((r) => r.ply)).toEqual([4, 8]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w apps/api -- session-move-notes.test`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/db/repositories/session-move-notes.ts
import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export interface SessionMoveNoteRow {
  id: string;
  sessionId: string;
  ply: number;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Upsert-wins semantics keyed on (sessionId, ply) — same full-replace
 * philosophy as update_threads: whichever write happens last for a ply
 * wins, whether that's the coach's record_move_note or the automatic
 * episode-close fallback (design doc §3). */
export function upsert(
  db: Kysely<Database>,
  sessionId: string,
  ply: number,
  note: string
): Promise<SessionMoveNoteRow> {
  return db
    .insertInto('sessionMoveNotes')
    .values({ sessionId, ply, note })
    .onConflict((oc) => oc.columns(['sessionId', 'ply']).doUpdateSet({ note, updatedAt: new Date() }))
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findByPly(
  db: Kysely<Database>,
  sessionId: string,
  ply: number
): Promise<SessionMoveNoteRow | undefined> {
  return db
    .selectFrom('sessionMoveNotes')
    .selectAll()
    .where('sessionId', '=', sessionId)
    .where('ply', '=', ply)
    .executeTakeFirst();
}

/** Other-moves-summary layer (design doc §5): every discussed ply except
 * the one currently open, oldest first. */
export function listOtherPlies(
  db: Kysely<Database>,
  sessionId: string,
  currentPly: number
): Promise<SessionMoveNoteRow[]> {
  return db
    .selectFrom('sessionMoveNotes')
    .selectAll()
    .where('sessionId', '=', sessionId)
    .where('ply', '!=', currentPly)
    .orderBy('ply', 'asc')
    .execute();
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w apps/api -- session-move-notes.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/repositories/session-move-notes.ts apps/api/src/db/repositories/session-move-notes.test.ts
git commit -m "feat: add session_move_notes repository"
```

---

### Task 4: Episode-scan pure logic

**Files:**
- Create: `apps/api/src/lib/episodes.ts`
- Test: `apps/api/src/lib/episodes.test.ts`

**Interfaces:**
- Produces: `EpisodeScanResult<T>`, `currentEpisode<T extends { ply: number | null }>(messages: T[], currentPly: number): EpisodeScanResult<T>`.
- Consumes: nothing (pure, no I/O — per `AGENTS.md` rule 5, testable with plain inputs/outputs, so it lives in `lib/`, not inline in a service).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/episodes.test.ts
import { describe, expect, test } from 'vitest';
import { currentEpisode } from './episodes.js';

interface Fixture {
  id: string;
  ply: number | null;
}

function message(id: string, ply: number | null): Fixture {
  return { id, ply };
}

describe('currentEpisode', () => {
  test('a fresh session with everything at ply 0 returns the whole transcript and no previousPly', () => {
    const messages = [message('1', 0), message('2', 0), message('3', 0)];
    const result = currentEpisode(messages, 0);
    expect(result.messages).toEqual(messages);
    expect(result.previousPly).toBeNull();
  });

  test('a contiguous run at the end sharing currentPly is returned; earlier plies are excluded', () => {
    const messages = [message('1', 0), message('2', 0), message('3', 4), message('4', 4)];
    const result = currentEpisode(messages, 4);
    expect(result.messages.map((m) => m.id)).toEqual(['3', '4']);
    expect(result.previousPly).toBe(0);
  });

  test('revisiting an earlier ply starts a fresh episode — the first visit is NOT merged back in', () => {
    const messages = [message('1', 0), message('2', 4), message('3', 4), message('4', 0), message('5', 0)];
    const result = currentEpisode(messages, 0);
    expect(result.messages.map((m) => m.id)).toEqual(['4', '5']);
    expect(result.previousPly).toBe(4);
  });

  test('an empty transcript returns an empty episode and no previousPly', () => {
    const result = currentEpisode([], 0);
    expect(result.messages).toEqual([]);
    expect(result.previousPly).toBeNull();
  });

  test('a null-ply message (legacy/untagged) never matches and acts as an episode boundary', () => {
    const messages = [message('1', null), message('2', 4), message('3', 4)];
    const result = currentEpisode(messages, 4);
    expect(result.messages.map((m) => m.id)).toEqual(['2', '3']);
    expect(result.previousPly).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w apps/api -- episodes.test`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/lib/episodes.ts

export interface EpisodeScanResult<T> {
  messages: T[];
  previousPly: number | null;
}

/**
 * Coach context restructure design §1: an episode is the contiguous run of
 * messages at the end of an append-only, ply-tagged transcript sharing
 * `currentPly`. Scanned backward in memory (not a SQL GROUP BY) because the
 * boundary depends on transcript order, which SQL grouping doesn't
 * preserve. `previousPly` is the ply of the message immediately before the
 * episode started — null if the episode spans the whole transcript (e.g.
 * the session's very first episode).
 */
export function currentEpisode<T extends { ply: number | null }>(
  messages: T[],
  currentPly: number
): EpisodeScanResult<T> {
  let start = messages.length;
  while (start > 0 && messages[start - 1]?.ply === currentPly) {
    start--;
  }
  return {
    messages: messages.slice(start),
    previousPly: start > 0 ? (messages[start - 1]?.ply ?? null) : null
  };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w apps/api -- episodes.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/episodes.ts apps/api/src/lib/episodes.test.ts
git commit -m "feat: add pure episode-scan logic over ply-tagged transcripts"
```

---

### Task 5: `packages/prompts/src/render.ts` — `describeMoveRef` and `renderThreadsBlock`

**Files:**
- Modify: `packages/prompts/src/render.ts`
- Test: `packages/prompts/src/render.test.ts`

**Interfaces:**
- Produces: `describeMoveRef(ply: number): string` (extracted from the existing private move-ref logic in `renderMoment`, no behavior change), `renderThreadsBlock(threads: Thread[]): string`.
- Consumes: `plyToMoveRef` from `@chess-coach/chess-analysis` (already imported here), `Thread` from `@chess-coach/shared`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/prompts/src/render.test.ts` (alongside its existing tests — read the file first to match its existing style/imports):

```ts
import { describeMoveRef, renderThreadsBlock } from './render.js';
import type { Thread } from '@chess-coach/shared';

describe('describeMoveRef', () => {
  test('ply 0 is the game start', () => {
    expect(describeMoveRef(0)).toBe('the game start');
  });

  test('an odd ply is White\'s move', () => {
    expect(describeMoveRef(35)).toBe("White's move 18");
  });

  test('an even ply is Black\'s move', () => {
    expect(describeMoveRef(36)).toBe("Black's move 18");
  });
});

describe('renderThreadsBlock', () => {
  test('an empty ledger renders a fallback, not an empty string', () => {
    expect(renderThreadsBlock([])).toBe('(empty — no parked topics right now)');
  });

  test('renders status, topic, and hypothesis when present', () => {
    const threads: Thread[] = [
      { id: 1, topic: 'the h3 line', status: 'parked', hypothesis: null, anchorPly: null, anchorFen: null },
      {
        id: 2,
        topic: 'king safety pattern',
        status: 'active',
        hypothesis: 'stops calculating after the first capture',
        anchorPly: null,
        anchorFen: null
      }
    ];
    expect(renderThreadsBlock(threads)).toBe(
      '- [parked] the h3 line\n- [active] king safety pattern (hypothesis: stops calculating after the first capture)'
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w packages/prompts -- render.test`
Expected: FAIL — `describeMoveRef`/`renderThreadsBlock` aren't exported.

- [ ] **Step 3: Implement**

In `packages/prompts/src/render.ts`, add the import and two new exports, and refactor `renderMoment` to reuse `describeMoveRef`:

```ts
import type { Thread } from '@chess-coach/shared';
```

```ts
/** Standard chess move-pair phrasing for any ply — "the game start" for
 * ply 0, otherwise "White's/Black's move N". Shared by the coaching-plan
 * renderer and the coach context restructure's annotated-PGN/other-moves-
 * summary/current-move-block renderers (packages/prompts/src/episode-
 * context.ts) so they all describe a ply identically. */
export function describeMoveRef(ply: number): string {
  const ref = plyToMoveRef(ply);
  return ref.color === null ? 'the game start' : `${capitalize(ref.color)}'s move ${ref.moveNumber}`;
}

function renderMoment(moment: CoachingPlan['moments'][number]): string {
  return `${describeMoveRef(moment.ply)} (${moment.kind}): "${moment.socraticQuestion}" Key line: ${moment.keyLine}`;
}
```

(Delete the old `renderMoment` body's inline `plyToMoveRef`/`moveRef` computation — it's now `describeMoveRef`. Leave `capitalize` as-is.)

```ts
/** Coach context restructure design §5, layer 5: the backstage conversation
 * ledger, finally rendered into the live prompt (previously computed but
 * never injected). */
export function renderThreadsBlock(threads: Thread[]): string {
  if (threads.length === 0) return '(empty — no parked topics right now)';
  return threads.map(renderThreadLine).join('\n');
}

function renderThreadLine(thread: Thread): string {
  const hypothesis = thread.hypothesis ? ` (hypothesis: ${thread.hypothesis})` : '';
  return `- [${thread.status}] ${thread.topic}${hypothesis}`;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w packages/prompts -- render.test`
Expected: PASS — including the pre-existing `renderCoachingPlanBlock`/`renderMoment` tests, unchanged, since `describeMoveRef` is a pure extraction with identical behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/prompts/src/render.ts packages/prompts/src/render.test.ts
git commit -m "feat: extract describeMoveRef and add renderThreadsBlock to packages/prompts"
```

---

### Task 6: `packages/prompts/src/episode-context.ts` — annotated PGN, other-moves summary, current-move block

**Files:**
- Create: `packages/prompts/src/episode-context.ts`
- Test: `packages/prompts/src/episode-context.test.ts`
- Modify: `packages/prompts/src/index.ts` (add `export * from './episode-context.js';`)

**Interfaces:**
- Consumes: `ClassifiedMove` from `@chess-coach/chess-analysis`, `isSoundQuality` from `@chess-coach/chess-analysis`, `MOVE_QUALITY_SYMBOLS`/`MoveQuality` from `@chess-coach/shared`, `describeMoveRef` from `./render.js` (Task 5).
- Produces: `renderAnnotatedPgn(moves: ClassifiedMove[]): string`, `MoveNoteEntry`, `MoveQualityEntry`, `renderOtherMovesSummary(notes: MoveNoteEntry[], qualities: MoveQualityEntry[]): string`, `renderCurrentMoveBlock(ply: number, fen: string, previousPly: number | null): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/prompts/src/episode-context.test.ts
import { describe, expect, test } from 'vitest';
import type { ClassifiedMove } from '@chess-coach/chess-analysis';
import { renderAnnotatedPgn, renderCurrentMoveBlock, renderOtherMovesSummary } from './episode-context.js';

function move(overrides: Partial<ClassifiedMove> & Pick<ClassifiedMove, 'ply' | 'moveSan' | 'quality'>): ClassifiedMove {
  return {
    mover: overrides.ply % 2 === 1 ? 'white' : 'black',
    isUserMove: true,
    cpLoss: 0,
    bestLineSan: [],
    evalAfterCp: 0,
    hangsPiece: false,
    ...overrides
  };
}

describe('renderAnnotatedPgn', () => {
  test('no moves renders a fallback under the heading', () => {
    expect(renderAnnotatedPgn([])).toBe('## This game (annotated)\n\n(no moves)');
  });

  test('sound moves (good/best) get only the quality symbol, no extra detail', () => {
    const moves = [
      move({ ply: 1, moveSan: 'e4', quality: 'best' }),
      move({ ply: 2, moveSan: 'e5', quality: 'good' })
    ];
    expect(renderAnnotatedPgn(moves)).toBe('## This game (annotated)\n\n1.e4★ e5!');
  });

  test('unsound moves (mistake/blunder/miss/dubious) get cpLoss and the best line inline', () => {
    // ply 17 = White's move 9 (odd ply); an odd ply is what carries the "N."
    // prefix — the fixture must use an odd ply for the "9." to appear at all.
    const moves = [move({ ply: 17, moveSan: 'Bg4', quality: 'mistake', cpLoss: 180, bestLineSan: ['h6', 'Bh4'] })];
    expect(renderAnnotatedPgn(moves)).toBe('## This game (annotated)\n\n9.Bg4? (lost ~180cp, best h6)');
  });
});

describe('renderOtherMovesSummary', () => {
  test('no notes renders a fallback under the heading', () => {
    expect(renderOtherMovesSummary([], [])).toBe(
      '## Other moves discussed\n\n(nothing discussed yet outside the current move)'
    );
  });

  test('one line per note, oldest first, with the quality tag when known', () => {
    const notes = [{ ply: 35, note: 'missed Rxd5, assigned as homework' }];
    const qualities = [{ ply: 35, quality: 'blunder' as const }];
    expect(renderOtherMovesSummary(notes, qualities)).toBe(
      "## Other moves discussed\n\n- White's move 18 (blunder): missed Rxd5, assigned as homework"
    );
  });

  test('a note with no matching classified move omits the quality tag', () => {
    const notes = [{ ply: 4, note: 'student asked about the opening name' }];
    expect(renderOtherMovesSummary(notes, [])).toBe(
      "## Other moves discussed\n\n- Black's move 2: student asked about the opening name"
    );
  });
});

describe('renderCurrentMoveBlock', () => {
  test('the first episode of a session has no "reached from" sentence', () => {
    const text = renderCurrentMoveBlock(0, 'startpos-fen', null);
    expect(text).toContain('You are now discussing the game start');
    expect(text).not.toContain('You reached this position from');
  });

  test('a jump includes where the coach/student arrived from', () => {
    const text = renderCurrentMoveBlock(35, 'fen-after-18', 8);
    expect(text).toContain("You are now discussing White's move 18");
    expect(text).toContain('FEN: fen-after-18');
    expect(text).toContain("You reached this position from Black's move 4");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w packages/prompts -- episode-context.test`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// packages/prompts/src/episode-context.ts
import type { ClassifiedMove } from '@chess-coach/chess-analysis';
import { isSoundQuality } from '@chess-coach/chess-analysis';
import { MOVE_QUALITY_SYMBOLS, type MoveQuality } from '@chess-coach/shared';
import { describeMoveRef } from './render.js';

/**
 * Coach context restructure design §5, layer 3: the whole game as annotated
 * SAN (chess.com/lichess quality-symbol convention). Static per game — this
 * block is byte-identical every turn of a session, so it rides its own
 * cache breakpoint. Only unsound moves (mistake/blunder/miss/dubious) get
 * extra detail inline, so an 80-ply game doesn't bloat the block.
 */
export function renderAnnotatedPgn(moves: ClassifiedMove[]): string {
  const body = moves.length === 0 ? '(no moves)' : moves.map(renderAnnotatedMove).join(' ');
  return `## This game (annotated)\n\n${body}`;
}

function renderAnnotatedMove(move: ClassifiedMove): string {
  const symbol = MOVE_QUALITY_SYMBOLS[move.quality];
  const base = `${movePrefix(move.ply)}${move.moveSan}${symbol}`;
  if (isSoundQuality(move.quality)) return base;
  const bestLine = move.bestLineSan[0] ? `, best ${move.bestLineSan[0]}` : '';
  return `${base} (lost ~${move.cpLoss}cp${bestLine})`;
}

/** "N." before White's move, nothing before Black's — matches how a human
 * reads annotated PGN out loud. */
function movePrefix(ply: number): string {
  return ply % 2 === 1 ? `${Math.ceil(ply / 2)}.` : '';
}

export interface MoveNoteEntry {
  ply: number;
  note: string;
}

export interface MoveQualityEntry {
  ply: number;
  quality: MoveQuality;
}

/**
 * Design §5, layer 4: one line per previously-discussed move outside the
 * one currently open, so the coach can refer back ("move 22 you missed
 * Rxd5") without the whole detour's raw conversation ever being replayed.
 * Rebuilt every turn from session_move_notes — cheap, and only its own
 * cache entry busts when a note actually changes.
 */
export function renderOtherMovesSummary(notes: MoveNoteEntry[], qualities: MoveQualityEntry[]): string {
  const qualityByPly = new Map(qualities.map((entry) => [entry.ply, entry.quality]));
  const body =
    notes.length === 0
      ? '(nothing discussed yet outside the current move)'
      : notes.map((entry) => renderOtherMoveLine(entry, qualityByPly)).join('\n');
  return `## Other moves discussed\n\n${body}`;
}

function renderOtherMoveLine(entry: MoveNoteEntry, qualityByPly: Map<number, MoveQuality>): string {
  const quality = qualityByPly.get(entry.ply);
  return `- ${describeMoveRef(entry.ply)}${quality ? ` (${quality})` : ''}: ${entry.note}`;
}

/**
 * Design §5, layer 5: the one part of the prompt that changes every turn —
 * rides after every cache breakpoint instead of busting one. `previousPly`
 * (null for a session's very first episode) states where the coach or
 * student arrived from, so the model never has to infer it from scrollback.
 */
export function renderCurrentMoveBlock(ply: number, fen: string, previousPly: number | null): string {
  const arrival = previousPly !== null ? ` You reached this position from ${describeMoveRef(previousPly)}.` : '';
  return `## Current position\n\nYou are now discussing ${describeMoveRef(ply)} — this is what's actively on the board. FEN: ${fen}.${arrival}`;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w packages/prompts -- episode-context.test`
Expected: PASS

- [ ] **Step 5: Export from the package index**

In `packages/prompts/src/index.ts`, add:

```ts
export * from './episode-context.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/prompts/src/episode-context.ts packages/prompts/src/episode-context.test.ts packages/prompts/src/index.ts
git commit -m "feat: add annotated-PGN, other-moves-summary, and current-move-block renderers"
```

---

### Task 7: New tool parameter schemas — `record_move_note`, `recall_move`

**Files:**
- Modify: `packages/prompts/src/tools.ts`
- Modify: `packages/prompts/src/tools.test.ts`

**Interfaces:**
- Produces: `recordMoveNoteParameters` (`{ ply: number (int, >=0), note: string (1-300 chars) }`), `recallMoveParameters` (`{ ply: number (int, >=0) }`).

- [ ] **Step 1: Write the failing tests**

Add to `packages/prompts/src/tools.test.ts`:

```ts
import { recallMoveParameters, recordMoveNoteParameters } from './tools.js';

describe('record_move_note: { ply, note }', () => {
  test('accepts a nonnegative int ply and a short note', () => {
    expect(recordMoveNoteParameters.safeParse({ ply: 18, note: 'missed Rxd5, assigned as homework' }).success).toBe(
      true
    );
  });

  test('rejects a negative ply and an empty note', () => {
    expect(recordMoveNoteParameters.safeParse({ ply: -1, note: 'x' }).success).toBe(false);
    expect(recordMoveNoteParameters.safeParse({ ply: 18, note: '' }).success).toBe(false);
  });
});

describe('recall_move: { ply }', () => {
  test('accepts a nonnegative int ply', () => {
    expect(recallMoveParameters.safeParse({ ply: 22 }).success).toBe(true);
  });

  test('rejects a missing ply', () => {
    expect(recallMoveParameters.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w packages/prompts -- tools.test`
Expected: FAIL — schemas aren't exported.

- [ ] **Step 3: Implement**

Add to `packages/prompts/src/tools.ts`:

```ts
/** design doc §3: coach-authored per-move note, discretionary (same pattern
 * as record_finding — not mandatory every move). */
export const recordMoveNoteParameters = z.object({
  ply: z.number().int().nonnegative(),
  note: z.string().min(1).max(300)
});

/** design doc §4: on-demand deeper lookup for a specific past move. */
export const recallMoveParameters = z.object({
  ply: z.number().int().nonnegative()
});
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w packages/prompts -- tools.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/prompts/src/tools.ts packages/prompts/src/tools.test.ts
git commit -m "feat: add record_move_note and recall_move parameter schemas"
```

---

### Task 8: Coach system prompt text — describe the two new tools

**Files:**
- Modify: `packages/prompts/src/coach-system.ts`
- Modify: `packages/prompts/src/coach-system.test.ts`

**Interfaces:**
- Consumes: nothing new (text-only change inside `yourToolsAndWhenToUseThem()`).

- [ ] **Step 1: Write the failing test**

Add to `packages/prompts/src/coach-system.test.ts` (find the existing `describe('buildCoachSystemPrompt', ...)` block and add inside it, or as a sibling describe):

```ts
test('staticPart tells the coach about record_move_note and recall_move', () => {
  const { staticPart } = buildCoachSystemPrompt(baseInput());
  expect(staticPart).toContain('record_move_note');
  expect(staticPart).toContain('recall_move');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w packages/prompts -- coach-system.test`
Expected: FAIL — the tool names don't appear in `staticPart` yet.

- [ ] **Step 3: Implement**

In `packages/prompts/src/coach-system.ts`'s `yourToolsAndWhenToUseThem()`, insert two new bullets after the `update_threads` line and before `end_session`:

```ts
- record_move_note: whenever you're about to leave a moment, jot a one-sentence note on what happened there ("missed Rxd5, discussed the pin, assigned as homework") — this is how you'll remember it later without re-reading the whole discussion. Discretionary, like record_finding: worth calling most of the time you leave a moment, not mechanically every single time.
- recall_move: if the one-line summary of an earlier move (in "Other moves discussed" below) isn't enough to answer the student, call this to pull up more detail on that specific move.
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w packages/prompts -- coach-system.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/prompts/src/coach-system.ts packages/prompts/src/coach-system.test.ts
git commit -m "feat: document record_move_note and recall_move in the coach system prompt"
```

---

### Task 9: `move-notes` service — validated write/read paths

**Files:**
- Create: `apps/api/src/services/move-notes.ts`
- Test: `apps/api/src/services/move-notes.test.ts`

**Interfaces:**
- Consumes: `getPositionAtPly` (Task-independent, already exists), `sessionMessagesRepo.listBySessionAndPly` (Task 2), `sessionMoveNotesRepo.upsert`/`findByPly` (Task 3), `compact`/`SummarizeFn` from `./session-context.js` (already exists, unchanged).
- Produces: `MoveNotesDependencies`, `MoveNotesContext`, `recordMoveNote(db, ctx, args)`, `recallMove(deps, ctx, requestedPly)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/services/move-notes.test.ts
import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as usersRepo from '../db/repositories/users.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import type { Database } from '../db/schema.js';
import { recallMove, recordMoveNote } from './move-notes.js';

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6';

describe('move-notes service', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedSession() {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn: PGN,
      source: 'paste',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    const session = await sessionsRepo.insert(db, { gameId: game.id, userId: user.id });
    return { sessionId: session.id, gameId: game.id };
  }

  describe('recordMoveNote', () => {
    test('a valid ply upserts a note', async () => {
      const { sessionId, gameId } = await seedSession();
      const result = await recordMoveNote(db, { sessionId, gameId }, { ply: 2, note: 'played the Ruy Lopez idea' });
      expect(result).toEqual({ recorded: true });
      const row = await sessionMoveNotesRepo.findByPly(db, sessionId, 2);
      expect(row?.note).toBe('played the Ruy Lopez idea');
    });

    test('a ply outside the game is rejected, never trusting the model\'s own arithmetic', async () => {
      const { sessionId, gameId } = await seedSession();
      const result = await recordMoveNote(db, { sessionId, gameId }, { ply: 999, note: 'x' });
      expect(result).toEqual({ error: 'that move does not exist in this game' });
    });
  });

  describe('recallMove', () => {
    function deps(callLightModel = vi.fn()) {
      return { db, callLightModel };
    }

    test('the currently-open ply short-circuits without touching the DB or the light model', async () => {
      const { sessionId, gameId } = await seedSession();
      const callLightModel = vi.fn();
      const result = await recallMove(deps(callLightModel), { sessionId, gameId, currentPly: 4 }, 4);
      expect(result).toEqual({ text: "that's the position you're already discussing — it's already in view." });
      expect(callLightModel).not.toHaveBeenCalled();
    });

    test('a ply outside the game is rejected', async () => {
      const { sessionId, gameId } = await seedSession();
      const result = await recallMove(deps(), { sessionId, gameId, currentPly: 0 }, 999);
      expect(result).toEqual({ error: 'that move does not exist in this game' });
    });

    test('a ply with no messages and no note returns the explicit "nothing recorded" case', async () => {
      const { sessionId, gameId } = await seedSession();
      const result = await recallMove(deps(), { sessionId, gameId, currentPly: 0 }, 4);
      expect(result).toEqual({ text: 'nothing recorded for that move yet' });
    });

    test('a ply with a note but no raw messages (already folded) falls back to the note verbatim', async () => {
      const { sessionId, gameId } = await seedSession();
      await sessionMoveNotesRepo.upsert(db, sessionId, 4, 'discussed the knight retreat');
      const result = await recallMove(deps(), { sessionId, gameId, currentPly: 0 }, 4);
      expect(result).toEqual({ text: 'discussed the knight retreat' });
    });

    test('a ply with raw messages gets a fresh light-tier digest of them', async () => {
      const { sessionId, gameId } = await seedSession();
      await sessionMessagesRepo.insert(db, sessionId, 'assistant', 'What did you consider here?', 4);
      await sessionMessagesRepo.insert(db, sessionId, 'user', 'I thought about Nf6', 4);
      const callLightModel = vi.fn().mockResolvedValue('Student considered Nf6 at this move.');

      const result = await recallMove(deps(callLightModel), { sessionId, gameId, currentPly: 0 }, 4);

      expect(result).toEqual({ text: 'Student considered Nf6 at this move.' });
      expect(callLightModel).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w apps/api -- move-notes.test`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/services/move-notes.ts
import type { Kysely } from 'kysely';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import type { Database } from '../db/schema.js';
import { getPositionAtPly } from './game-positions.js';
import { compact, type SummarizeFn } from './session-context.js';

export interface MoveNotesDependencies {
  db: Kysely<Database>;
  callLightModel: SummarizeFn;
}

export interface MoveNotesContext {
  sessionId: string;
  gameId: string;
}

/** record_move_note tool (design doc §3): coach-authored, validated the
 * same way check_position validates a ply — against the game's real move
 * list, never trusting the model's own arithmetic. */
export async function recordMoveNote(
  db: Kysely<Database>,
  ctx: MoveNotesContext,
  args: { ply: number; note: string }
): Promise<{ recorded: boolean } | { error: string }> {
  const position = await getPositionAtPly(db, ctx.gameId, args.ply);
  if (!position) return { error: 'that move does not exist in this game' };
  await sessionMoveNotesRepo.upsert(db, ctx.sessionId, args.ply, args.note);
  return { recorded: true };
}

/** recall_move tool (design doc §4): a fresh on-demand digest of a past
 * episode's full raw conversation — richer than the always-present
 * other-moves-summary line, which is just the closing note. Falls back to
 * that same note when the raw messages are gone (already folded), and to
 * an explicit "nothing recorded" when neither exists. */
export async function recallMove(
  deps: MoveNotesDependencies,
  ctx: MoveNotesContext & { currentPly: number },
  requestedPly: number
): Promise<{ text: string } | { error: string }> {
  if (requestedPly === ctx.currentPly) {
    return { text: "that's the position you're already discussing — it's already in view." };
  }

  const position = await getPositionAtPly(deps.db, ctx.gameId, requestedPly);
  if (!position) return { error: 'that move does not exist in this game' };

  const messages = await sessionMessagesRepo.listBySessionAndPly(deps.db, ctx.sessionId, requestedPly);
  if (messages.length === 0) {
    const note = await sessionMoveNotesRepo.findByPly(deps.db, ctx.sessionId, requestedPly);
    return note ? { text: note.note } : { text: 'nothing recorded for that move yet' };
  }

  const stored = messages.map((message) => ({ id: message.id, role: message.role, content: message.content }));
  const text = await compact(stored, null, deps.callLightModel);
  return { text };
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w apps/api -- move-notes.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/move-notes.ts apps/api/src/services/move-notes.test.ts
git commit -m "feat: add move-notes service for record_move_note and recall_move"
```

---

### Task 10: Wire `record_move_note` and `recall_move` into `coach-tools.ts`

**Files:**
- Modify: `apps/api/src/services/coach-tools.ts`
- Modify: `apps/api/src/services/coach-tools.test.ts`

**Interfaces:**
- Consumes: `recordMoveNoteParameters`/`recallMoveParameters` (Task 7), `recordMoveNote`/`recallMove` (Task 9), `sessionsRepo.findById` (already exists).
- Produces: two new entries in the `ToolSet` returned by `buildCoachTools`; `recall_move: 3` added to `TOOL_BUDGETS`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/services/coach-tools.test.ts` (inside the existing `describe('buildCoachTools', ...)`, following the file's existing `setupCtx`/`makeDeps` helpers):

```ts
describe('record_move_note', () => {
  test('validates the ply against the game and upserts a note', async () => {
    const { userId, gameId, sessionId } = await setupCtx('1. e4 e5 2. Nf3 Nc6');
    const tools = buildCoachTools({ userId, sessionId, gameId }, makeDeps());

    const ok = await tools.record_move_note?.execute?.(
      { ply: 2, note: 'discussed the fork' },
      { toolCallId: '1', messages: [] }
    );
    expect(ok).toEqual({ recorded: true });

    const rejected = await tools.record_move_note?.execute?.({ ply: 999, note: 'x' }, { toolCallId: '2', messages: [] });
    expect(rejected).toEqual({ error: 'that move does not exist in this game' });
  });
});

describe('recall_move', () => {
  test("reads the session's current ply and is budgeted", async () => {
    const { userId, gameId, sessionId } = await setupCtx('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');
    const tools = buildCoachTools({ userId, sessionId, gameId }, makeDeps());

    const nothingYet = await tools.recall_move?.execute?.({ ply: 2 }, { toolCallId: '1', messages: [] });
    expect(nothingYet).toEqual({ text: 'nothing recorded for that move yet' });

    // Distinct args each time — withTurnGuards caches by (name, args), so
    // repeating the same args would return the cached result without ever
    // re-checking the budget. Three distinct calls exhaust the budget of 3;
    // a fourth distinct call (never cached) is the one that actually hits it.
    await tools.recall_move?.execute?.({ ply: 4 }, { toolCallId: '2', messages: [] });
    await tools.recall_move?.execute?.({ ply: 6 }, { toolCallId: '3', messages: [] });
    const overBudget = await tools.recall_move?.execute?.({ ply: 1 }, { toolCallId: '4', messages: [] });
    expect(overBudget).toEqual({ error: 'budget_exhausted — answer with what you have' });
  });
});
```

(This matches the exact `tools.<name>?.execute?.(args, { toolCallId, messages: [] })` calling convention already used throughout this file's `check_position`/`get_engine_analysis`/`record_finding` tests.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w apps/api -- coach-tools.test`
Expected: FAIL — `record_move_note`/`recall_move` don't exist on the returned `ToolSet`.

- [ ] **Step 3: Implement**

In `apps/api/src/services/coach-tools.ts`:

Add to the imports from `@chess-coach/prompts`: `recallMoveParameters`, `recordMoveNoteParameters`. Add a new import:

```ts
import * as sessionsRepo from '../db/repositories/sessions.js';
import { recallMove, recordMoveNote } from './move-notes.js';
```

Add `recall_move: 3` to `TOOL_BUDGETS`:

```ts
const TOOL_BUDGETS: Partial<Record<string, number>> = {
  get_engine_analysis: 2,
  get_user_profile: 1,
  recall_move: 3
};
```

Add two entries to the object returned by `buildCoachTools`, right after `update_threads` and before `end_session`:

```ts
    record_move_note: tool({
      description:
        "Save a one-sentence note on a move you're about to leave, for your own later reference (e.g. \"missed Rxd5, discussed the pin, assigned as homework\"). Worth calling most of the time you leave a moment — not mechanically every single time.",
      parameters: recordMoveNoteParameters,
      execute: withTurnGuards(guardState, 'record_move_note', (args: { ply: number; note: string }) =>
        recordMoveNote(deps.db, ctx, args)
      )
    }),
    recall_move: tool({
      description:
        "Look up more detail on a specific earlier move in THIS session than the one-line summary already gives you.",
      parameters: recallMoveParameters,
      execute: withTurnGuards(guardState, 'recall_move', (args: { ply: number }) => recallMoveTool(deps, ctx, args))
    }),
```

Add the small helper (mirrors `checkPosition`'s shape) below the other private tool-handler functions:

```ts
async function recallMoveTool(
  deps: CoachToolsDependencies,
  ctx: CoachToolsContext,
  args: { ply: number }
): Promise<{ text: string } | { error: string }> {
  const session = await sessionsRepo.findById(deps.db, ctx.sessionId);
  return recallMove(deps, { sessionId: ctx.sessionId, gameId: ctx.gameId, currentPly: session?.currentPly ?? 0 }, args.ply);
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w apps/api -- coach-tools.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/coach-tools.ts apps/api/src/services/coach-tools.test.ts
git commit -m "feat: wire record_move_note and recall_move into the coach's tool set"
```

---

### Task 11: `coach-context.ts` — jump resolution, episode closing, five-layer assembly

**Files:**
- Create: `apps/api/src/services/coach-context.ts`
- Test: `apps/api/src/services/coach-context.test.ts`

**Interfaces:**
- Consumes: `currentEpisode` (Task 4), `renderAnnotatedPgn`/`renderOtherMovesSummary`/`renderCurrentMoveBlock`/`renderThreadsBlock` (Tasks 5–6), `sessionMoveNotesRepo` (Task 3), `analysesRepo.findClassifiedMovesByGameId` (already exists), `sessionsRepo.getThreads` (already exists), `getPositionAtPly` (already exists), `compact`/`prepareContext`/`StoredMessage`/`SummarizeFn` from `./session-context.js` (already exist, unchanged), `moveRefToPly` from `@chess-coach/chess-analysis`, `NotFoundError` from `../lib/errors.js`.
- Produces: `CoachContextDependencies`, `resolvePositionContextJump(db, gameId, content)`, `closeEpisodeIfNeeded(deps, sessionId, closedEpisodeMessages, closedPly)`, `EpisodeLayers`, `buildEpisodeMessages(layers, episodeMessages)`, `BuildEpisodeContextInput`, `buildEpisodeContext(input)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/services/coach-context.test.ts
import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import type { CoreMessage } from 'ai';
import { createTestDb, type TestDb } from '../../test/helpers/db.js';
import * as usersRepo from '../db/repositories/users.js';
import * as gamesRepo from '../db/repositories/games.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as sessionMessagesRepo from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as analysesRepo from '../db/repositories/analyses.js';
import type { Database } from '../db/schema.js';
import {
  buildEpisodeContext,
  buildEpisodeMessages,
  closeEpisodeIfNeeded,
  resolvePositionContextJump
} from './coach-context.js';

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6';

describe('buildEpisodeMessages', () => {
  test('four cached system blocks each with their own ephemeral breakpoint, one uncached, then the episode conversation verbatim', () => {
    const episodeMessages: CoreMessage[] = [{ role: 'user', content: 'hi coach' }];
    const messages = buildEpisodeMessages(
      {
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC',
        annotatedPgn: 'PGN',
        otherMovesSummary: 'OTHER',
        currentMoveBlock: 'CURRENT'
      },
      episodeMessages
    );

    const cacheControl = { anthropic: { cacheControl: { type: 'ephemeral' } } };
    expect(messages).toHaveLength(6);
    expect(messages[0]).toEqual({ role: 'system', content: 'STATIC', providerOptions: cacheControl });
    expect(messages[1]).toEqual({ role: 'system', content: 'DYNAMIC', providerOptions: cacheControl });
    expect(messages[2]).toEqual({ role: 'system', content: 'PGN', providerOptions: cacheControl });
    expect(messages[3]).toEqual({ role: 'system', content: 'OTHER', providerOptions: cacheControl });
    expect(messages[4]).toEqual({ role: 'system', content: 'CURRENT' });
    expect(messages[5]).toBe(episodeMessages[0]);
  });
});

describe('coach-context', () => {
  let testDb: TestDb;
  let db: Kysely<Database>;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedSession(pgn = PGN) {
    const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
    const game = await gamesRepo.insert(db, {
      userId: user.id,
      pgn,
      source: 'paste',
      userColor: 'white',
      whiteName: null,
      blackName: null,
      result: null,
      timeControl: null,
      eco: null,
      playedAt: null
    });
    const session = await sessionsRepo.insert(db, { gameId: game.id, userId: user.id });
    return { session, gameId: game.id };
  }

  describe('resolvePositionContextJump', () => {
    test('parses a valid [position_context] sentinel and validates it against the real game', async () => {
      const { gameId } = await seedSession();
      const jump = await resolvePositionContextJump(
        db,
        gameId,
        '[position_context] Back at move 2 (white), after Nf3: what about here instead?'
      );
      expect(jump).toEqual({ ply: 3 });
    });

    test('a ply beyond the game\'s length is never trusted, even if the text parses', async () => {
      const { gameId } = await seedSession('1. e4 e5');
      const jump = await resolvePositionContextJump(
        db,
        gameId,
        '[position_context] Back at move 40 (white), after Qxf7: huh?'
      );
      expect(jump).toBeNull();
    });

    test('ordinary text with no sentinel is not a jump', async () => {
      const { gameId } = await seedSession();
      const jump = await resolvePositionContextJump(db, gameId, 'what should I play here?');
      expect(jump).toBeNull();
    });
  });

  describe('closeEpisodeIfNeeded', () => {
    function deps(callLightModel = vi.fn().mockResolvedValue('folded note')) {
      return { db, callLightModel };
    }

    test('an episode with no record_move_note call gets an automatic note', async () => {
      const { session } = await seedSession();
      const closed = await sessionMessagesRepo.insert(db, session.id, 'assistant', 'Discussing move 2.', 2);

      await closeEpisodeIfNeeded(deps(), session.id, [closed], 2);

      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 2);
      expect(note?.note).toBe('folded note');
    });

    test('an episode where the coach already called record_move_note for this ply is left alone', async () => {
      const { session } = await seedSession();
      const closed = await sessionMessagesRepo.insert(
        db,
        session.id,
        'assistant',
        [{ type: 'tool-call', toolCallId: 'c1', toolName: 'record_move_note', args: { ply: 2, note: 'coach wrote this' } }],
        2
      );
      const callLightModel = vi.fn();

      await closeEpisodeIfNeeded(deps(callLightModel), session.id, [closed], 2);

      expect(callLightModel).not.toHaveBeenCalled();
      const note = await sessionMoveNotesRepo.findByPly(db, session.id, 2);
      expect(note).toBeUndefined();
    });

    test('an empty closed episode is a no-op', async () => {
      const { session } = await seedSession();
      const callLightModel = vi.fn();
      await closeEpisodeIfNeeded(deps(callLightModel), session.id, [], 2);
      expect(callLightModel).not.toHaveBeenCalled();
    });
  });

  describe('buildEpisodeContext', () => {
    test('a past episode\'s raw messages are excluded from the request; only its note appears, in the other-moves-summary layer', async () => {
      const { session, gameId } = await seedSession();
      await analysesRepo.insertQueued(db, gameId).then((a) => analysesRepo.storeClassifiedMoves(db, a.id, []));
      await sessionMessagesRepo.insert(db, session.id, 'user', '[session_start]', 0);
      await sessionMessagesRepo.insert(db, session.id, 'assistant', 'raw talk about move 18 you should never see again', 4);
      await sessionMoveNotesRepo.upsert(db, session.id, 4, 'discussed the knight development');
      await sessionsRepo.updateCurrentPly(db, session.id, 6);
      const current = await sessionMessagesRepo.insert(db, session.id, 'user', 'now discussing this move', 6);

      const historyAfterTurn = await sessionMessagesRepo.listBySession(db, session.id);
      const freshSession = { ...session, currentPly: 6 };

      const messages = await buildEpisodeContext({
        db,
        callLightModel: vi.fn(),
        session: freshSession,
        currentPly: 6,
        historyAfterTurn,
        staticPart: 'STATIC',
        dynamicPart: 'DYNAMIC'
      });

      const serialized = JSON.stringify(messages);
      expect(serialized).not.toContain('raw talk about move 18');
      expect(serialized).toContain('discussed the knight development');
      expect(messages.at(-1)).toEqual(current);
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w apps/api -- coach-context.test`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/services/coach-context.ts
import type { CoreMessage } from 'ai';
import type { Kysely } from 'kysely';
import { moveRefToPly } from '@chess-coach/chess-analysis';
import { renderAnnotatedPgn, renderCurrentMoveBlock, renderOtherMovesSummary, renderThreadsBlock } from '@chess-coach/prompts';
import * as analysesRepo from '../db/repositories/analyses.js';
import type { SessionMessageRow } from '../db/repositories/session-messages.js';
import * as sessionMoveNotesRepo from '../db/repositories/session-move-notes.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import type { SessionRow } from '../db/repositories/sessions.js';
import type { Database } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import { currentEpisode } from '../lib/episodes.js';
import { getPositionAtPly } from './game-positions.js';
import { compact, prepareContext, type StoredMessage, type SummarizeFn } from './session-context.js';

const EPISODE_BUDGET_TOKENS = 6000;
const POSITION_CONTEXT_PATTERN = /^\[position_context\] Back at move (\d+) \((white|black)\),/;

export interface CoachContextDependencies {
  db: Kysely<Database>;
  callLightModel: SummarizeFn;
}

/**
 * Server-side counterpart of apps/web's encodePositionContext (design doc
 * §2) — "never trust the client": the claimed ply is re-derived from the
 * game's real move list via getPositionAtPly, exactly like show_position's
 * result already is, never taken on faith from the sentinel text.
 */
export async function resolvePositionContextJump(
  db: Kysely<Database>,
  gameId: string,
  content: string
): Promise<{ ply: number } | null> {
  const match = POSITION_CONTEXT_PATTERN.exec(content);
  if (!match?.[1] || !match[2]) return null;
  const ply = moveRefToPly(Number(match[1]), match[2] as 'white' | 'black');
  const position = await getPositionAtPly(db, gameId, ply);
  return position ? { ply } : null;
}

/**
 * Design doc §3: when an episode closes (the coach or the student moves on
 * from `closedPly`) without a coach-authored record_move_note for that ply,
 * fold its raw messages into one automatically so the next turn's
 * other-moves-summary still has something to say about it.
 */
export async function closeEpisodeIfNeeded(
  deps: CoachContextDependencies,
  sessionId: string,
  closedEpisodeMessages: SessionMessageRow[],
  closedPly: number
): Promise<void> {
  if (closedEpisodeMessages.length === 0) return;
  if (hasRecordMoveNoteCall(closedEpisodeMessages, closedPly)) return;

  const note = await compact(toStoredMessages(closedEpisodeMessages), null, deps.callLightModel);
  await sessionMoveNotesRepo.upsert(deps.db, sessionId, closedPly, note);
}

export interface EpisodeLayers {
  staticPart: string;
  dynamicPart: string;
  annotatedPgn: string;
  otherMovesSummary: string;
  currentMoveBlock: string;
}

/**
 * Design doc §5: four cached system blocks (static/dynamic/annotated-PGN/
 * other-moves), each with its own breakpoint, then the uncached
 * current-move block, then the episode's own conversation. Two leading
 * cached system messages already worked this way (the old
 * buildCacheableMessages) — this extends the same pattern to five.
 */
export function buildEpisodeMessages(layers: EpisodeLayers, episodeMessages: CoreMessage[]): CoreMessage[] {
  const cacheControl = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
  return [
    { role: 'system', content: layers.staticPart, providerOptions: cacheControl },
    { role: 'system', content: layers.dynamicPart, providerOptions: cacheControl },
    { role: 'system', content: layers.annotatedPgn, providerOptions: cacheControl },
    { role: 'system', content: layers.otherMovesSummary, providerOptions: cacheControl },
    { role: 'system', content: layers.currentMoveBlock },
    ...episodeMessages
  ];
}

export interface BuildEpisodeContextInput extends CoachContextDependencies {
  /** Only `.gameId`/`.id` are read — `.currentPly` is deliberately ignored in
   * favor of the `currentPly` field below, which reflects any jump/
   * show_position update already applied earlier in this same turn (the
   * `session` object itself is whatever was fetched before that happened). */
  session: SessionRow;
  currentPly: number;
  historyAfterTurn: SessionMessageRow[];
  staticPart: string;
  dynamicPart: string;
}

/** Assembles the five-layer request in place of the old whole-transcript
 * replay (design doc §5) — purely a function of what's in the DB right now,
 * so a session resumed on a different pod after a restart reconstructs the
 * same layering with no in-memory state. */
export async function buildEpisodeContext(input: BuildEpisodeContextInput): Promise<CoreMessage[]> {
  const episode = currentEpisode(input.historyAfterTurn, input.currentPly);

  const [position, classifiedMoves, otherNotes, threads] = await Promise.all([
    getPositionAtPly(input.db, input.session.gameId, input.currentPly),
    analysesRepo.findClassifiedMovesByGameId(input.db, input.session.gameId),
    sessionMoveNotesRepo.listOtherPlies(input.db, input.session.id, input.currentPly),
    sessionsRepo.getThreads(input.db, input.session.id)
  ]);
  if (!position) throw new NotFoundError('Current position not found for this session');

  const annotatedPgn = renderAnnotatedPgn(classifiedMoves ?? []);
  const otherMovesSummary = renderOtherMovesSummary(otherNotes, classifiedMoves ?? []);
  const currentMoveBlock = [
    renderCurrentMoveBlock(input.currentPly, position.fen, episode.previousPly),
    '## Your thread ledger',
    renderThreadsBlock(threads)
  ].join('\n\n');

  const episodeMessages = await resolveEpisodeReplay(input, input.session.id, episode.messages, input.currentPly);

  return buildEpisodeMessages(
    {
      staticPart: input.staticPart,
      dynamicPart: input.dynamicPart,
      annotatedPgn,
      otherMovesSummary,
      currentMoveBlock
    },
    episodeMessages
  );
}

/**
 * Long-running-episode safety net (design doc §3): reuses session-
 * context.ts's budget/cooldown compaction, scoped to just this episode.
 * `findByPly` may return a note from *this same* open episode's own earlier
 * fold, or — on a revisit — the closing note from an *earlier, separate*
 * visit to this exact ply. Either way it's used as the seed digest: on a
 * revisit that's a deliberate, small carry-over ("what did we already
 * conclude about this move last time"), not the raw-replay confusion the
 * episode boundary exists to prevent — only a past visit's *raw messages*
 * are excluded from this episode's scan (lib/episodes.ts's currentEpisode),
 * never its one-line note.
 */
async function resolveEpisodeReplay(
  deps: CoachContextDependencies,
  sessionId: string,
  episodeMessages: SessionMessageRow[],
  currentPly: number
): Promise<CoreMessage[]> {
  const stored = toStoredMessages(episodeMessages);
  const existingNote = await sessionMoveNotesRepo.findByPly(deps.db, sessionId, currentPly);
  const initialDigest = existingNote?.note ?? null;
  const prepared = prepareContext(stored, initialDigest, EPISODE_BUDGET_TOKENS);

  if (!prepared.needsCompaction) {
    return prepared.replayMessages.map(toCoreMessage);
  }

  const keptCount = Math.ceil(stored.length / 2);
  const foldedMessages = stored.slice(0, stored.length - keptCount);
  const newDigest = await compact(foldedMessages, initialDigest, deps.callLightModel);
  await sessionMoveNotesRepo.upsert(deps.db, sessionId, currentPly, newDigest);

  const kept = stored.slice(stored.length - keptCount);
  const digestMessage: StoredMessage = { id: 'digest', role: 'user', content: `[this move so far] ${newDigest}` };
  return [digestMessage, ...kept].map(toCoreMessage);
}

function toStoredMessages(messages: SessionMessageRow[]): StoredMessage[] {
  return messages.map((message) => ({ id: message.id, role: message.role, content: message.content }));
}

function toCoreMessage(message: StoredMessage): CoreMessage {
  return { role: message.role, content: message.content } as CoreMessage;
}

function hasRecordMoveNoteCall(messages: SessionMessageRow[], ply: number): boolean {
  return messages.some(
    (message) => Array.isArray(message.content) && message.content.some((part) => isRecordMoveNoteCallForPly(part, ply))
  );
}

function isRecordMoveNoteCallForPly(part: unknown, ply: number): boolean {
  if (typeof part !== 'object' || part === null) return false;
  const candidate = part as { type?: unknown; toolName?: unknown; args?: unknown };
  if (candidate.type !== 'tool-call' || candidate.toolName !== 'record_move_note') return false;
  return (candidate.args as { ply?: unknown } | undefined)?.ply === ply;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w apps/api -- coach-context.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/coach-context.ts apps/api/src/services/coach-context.test.ts
git commit -m "feat: add coach-context service — jump resolution, episode closing, five-layer assembly"
```

---

### Task 12: Wire `coach-context.ts` into `coach-agent.ts`

**Files:**
- Modify: `apps/api/src/services/coach-agent.ts`
- Modify: `apps/api/src/services/coach-agent.test.ts`

**Interfaces:**
- Consumes: everything from Task 11 (`resolvePositionContextJump`, `closeEpisodeIfNeeded`, `buildEpisodeContext`).
- Removes: `buildCacheableMessages` and the private `toCoreMessage` helper (superseded by `coach-context.ts`'s own copy — no longer used from `coach-agent.ts`).
- Changes: `sessionMessagesRepo.insert` call sites now pass an explicit `ply`; `applyClientToolResult`'s signature changes to `(deps, session, toolResult, currentPly) => Promise<number>` (returns the possibly-updated ply).

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/services/coach-agent.test.ts`, inside (or alongside) the existing `describe('coach-agent startTurn concurrency', ...)` block so it can reuse the file's `deps()`/`drain()`/`controllableStreamModel`/`instantTextModel` helpers and `testDb`:

```ts
test('a show_position tool-call and its later-confirmed tool-result stay in the same episode — no orphaned tool_result once the position moves', async () => {
  const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
  await creditsRepo.insertSignupGrant(db, user.id);
  const game = await gamesRepo.insert(db, {
    userId: user.id,
    pgn: PGN,
    source: 'paste',
    userColor: 'white',
    whiteName: 'Ann',
    blackName: 'Bob',
    result: '1-0',
    timeControl: '10+0',
    eco: null,
    playedAt: null
  });
  const analysis = await analysesRepo.insertQueued(db, game.id);
  await analysesRepo.markReady(db, analysis.id, PLAN);
  await analysesRepo.storeClassifiedMoves(db, analysis.id, []);
  const session = await coachAgent.createSession(db, user.id, game.id);

  // Turn 1: the model itself calls show_position — no clientToolResult
  // input yet, this is the coach DECIDING to move, before any client
  // round-trip. currentPly is still 0 when this turn starts.
  const { model: showModel, finish: showFinish } = controllableStreamModel('Let me show you.', {
    toolCallId: 'call-show-1',
    toolName: 'show_position',
    args: { moveNumber: 2, color: 'black' }
  });
  const turn1 = await coachAgent.startTurn(deps(showModel), session, { content: 'hi coach' });
  const drain1 = drain(turn1);
  void showFinish();
  await drain1;

  // Turn 2: the client confirms the move actually happened.
  const turn2 = await coachAgent.startTurn(deps(instantTextModel('Here it is.')), session, {
    clientToolResult: { toolCallId: 'call-show-1', toolName: 'show_position', result: { moveNumber: 2, color: 'black', ply: 4 } }
  });
  await drain(turn2);

  // Turn 3: an ordinary follow-up in the same (now-current) episode. This is
  // the turn whose request would break if the tool-call landed in a
  // different episode than its tool-result.
  const turn3 = await coachAgent.startTurn(deps(instantTextModel('Sure.')), session, { content: 'what about here?' });
  await drain(turn3);

  const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
  const conversation = (snapshot?.request.messages ?? []).filter((m) => (m as { role: string }).role !== 'system');

  // The episode's first message must be the assistant's tool-call, never a
  // bare tool-result with no matching tool-call earlier in the same request
  // — that shape is what real Anthropic/OpenAI requests reject.
  expect(conversation[0]).toMatchObject({ role: 'assistant' });
  const firstToolResultIndex = conversation.findIndex((m) => (m as { role: string }).role === 'tool');
  expect(firstToolResultIndex).toBeGreaterThan(0);
}, 20000);

test('a jump back to an earlier move closes the old episode into a note and the new turn\'s request excludes that episode\'s raw messages', async () => {
  const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
  await creditsRepo.insertSignupGrant(db, user.id);
  const game = await gamesRepo.insert(db, {
    userId: user.id,
    pgn: PGN,
    source: 'paste',
    userColor: 'white',
    whiteName: 'Ann',
    blackName: 'Bob',
    result: '1-0',
    timeControl: '10+0',
    eco: null,
    playedAt: null
  });
  const analysis = await analysesRepo.insertQueued(db, game.id);
  await analysesRepo.markReady(db, analysis.id, PLAN);
  await analysesRepo.storeClassifiedMoves(db, analysis.id, []);
  const session = await coachAgent.createSession(db, user.id, game.id);

  // Turn 1: coach shows move 2 for white (ply 3) and talks about it.
  const moveTurn = await coachAgent.startTurn(deps(instantTextModel('Talking about move 2.')), session, {
    clientToolResult: { toolCallId: 'call-1', toolName: 'show_position', result: { moveNumber: 2, color: 'white', ply: 3 } }
  });
  await drain(moveTurn);

  // Turn 2: student jumps back to the game start and sends a message.
  const jumpTurn = await coachAgent.startTurn(deps(instantTextModel('Sure, back at the start.')), session, {
    content: '[position_context] Back at move 0 (white), after start: what about a different opening?'
  });
  await drain(jumpTurn);

  const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
  const requestMessages = JSON.stringify(snapshot?.request.messages);

  expect(requestMessages).not.toContain('Talking about move 2.');
  expect(requestMessages).toContain('different opening');

  const note = await db
    .selectFrom('sessionMoveNotes')
    .selectAll()
    .where('sessionId', '=', session.id)
    .where('ply', '=', 3)
    .executeTakeFirst();
  expect(note).toBeDefined();
}, 20000);

test('a resumed session (fresh deps, no in-memory state) reconstructs the same five-layer request purely from the DB', async () => {
  const user = await usersRepo.insert(db, { email: `${crypto.randomUUID()}@example.com`, displayName: 'Ann' });
  await creditsRepo.insertSignupGrant(db, user.id);
  const game = await gamesRepo.insert(db, {
    userId: user.id,
    pgn: PGN,
    source: 'paste',
    userColor: 'white',
    whiteName: 'Ann',
    blackName: 'Bob',
    result: '1-0',
    timeControl: '10+0',
    eco: null,
    playedAt: null
  });
  const analysis = await analysesRepo.insertQueued(db, game.id);
  await analysesRepo.markReady(db, analysis.id, PLAN);
  await analysesRepo.storeClassifiedMoves(db, analysis.id, []);
  const session = await coachAgent.createSession(db, user.id, game.id);

  const turn1 = await coachAgent.startTurn(deps(instantTextModel('Hello!')), session, { content: 'hi coach' });
  await drain(turn1);

  // Simulate a fresh process picking up the same session: a brand-new deps
  // object, no closures or caches carried over from turn 1.
  const turn2 = await coachAgent.startTurn(deps(instantTextModel('Welcome back.')), session, { content: 'hi again' });
  await drain(turn2);

  const snapshot = await coachAgent.getLastTurnDebugSnapshot(db, session.id);
  const [systemStatic, systemDynamic, systemPgn, systemOther, systemCurrent] = snapshot?.request.messages ?? [];
  expect(systemStatic).toMatchObject({ role: 'system' });
  expect(systemDynamic).toMatchObject({ role: 'system' });
  expect(systemPgn).toMatchObject({ role: 'system' });
  expect(systemOther).toMatchObject({ role: 'system' });
  expect(systemCurrent).toMatchObject({ role: 'system' });
}, 20000);
```

Also replace the old `describe('buildCacheableMessages', ...)` block (lines ~344–363) — delete it; `buildEpisodeMessages`'s equivalent test now lives in `coach-context.test.ts` (Task 11).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -w apps/api -- coach-agent.test`
Expected: FAIL — `startTurn` still replays the whole transcript, doesn't parse `[position_context]`, and doesn't advance the write-time ply tag when a `show_position` tool-call streams in; `buildCacheableMessages` no longer being referenced from the deleted test is fine, but the three new tests fail against current behavior.

- [ ] **Step 3: Implement**

In `apps/api/src/services/coach-agent.ts`:

Replace the import block's relevant lines — remove nothing from imports yet except after confirming `buildCoachSystemPrompt` etc. stay; add:

```ts
import * as coachContext from './coach-context.js';
```

Update `createSession` to tag the session-start message:

```ts
export async function createSession(
  db: Kysely<Database>,
  userId: string,
  gameId: string
): Promise<SessionRow> {
  const game = await gamesRepo.findByIdForUser(db, gameId, userId);
  if (!game) throw new NotFoundError('Game not found');

  const session = await sessionsRepo.insert(db, { gameId: game.id, userId });
  await sessionMessagesRepo.insert(db, session.id, 'user', SESSION_START_CONTENT, session.currentPly);
  return session;
}
```

Replace the entire body of `startTurn` (from the function signature's opening `{` down through the closing `}` that matches it, i.e. everything currently between `export async function startTurn(...)` and the `applyClientToolResult` function that follows it) with:

```ts
export async function startTurn(
  deps: CoachAgentDependencies,
  session: SessionRow,
  input: StartTurnInput
): Promise<StreamTextResult<ToolSet, never>> {
  // Held until onFinish below has persisted this turn's messages — a client
  // tool-result arrives as a brand-new HTTP request the instant the tool-call
  // streams to the browser, which can otherwise race this turn's own
  // still-in-flight persistence and read the history before its own
  // tool-call message exists (the tool-result then lands first, an ordering
  // OpenAI rejects on every future replay of the session).
  const release = await sessionLock.acquire(session.id);
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    release();
  };

  try {
    const resolveModel = deps.resolveModel ?? getModelForUser;
    const resolution = await resolveModel(deps.db, deps.gatewayConfig, session.userId, 'standard');

    if (resolution.metered) {
      const creditsService = deps.creditsService ?? createCreditsService(deps.db);
      try {
        await creditsService.assertCanSpend(session.userId);
      } catch (error) {
        await sessionsRepo.markPausedNoCredits(deps.db, session.id);
        throw error instanceof InsufficientCreditsError
          ? error
          : new InsufficientCreditsError('Insufficient credits');
      }
    }

    // Tracks the ply this turn's messages get tagged with — starts at
    // whatever was current before this turn, and only ever moves forward
    // via a resolved jump or a show_position client-tool-result, both
    // below. Read by the onFinish closure further down.
    let currentPly = session.currentPly;

    if (input.content !== undefined) {
      const jump = await coachContext.resolvePositionContextJump(deps.db, session.gameId, input.content);
      if (jump && jump.ply !== currentPly) {
        const historyBeforeTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
        const closedEpisode = currentEpisode(historyBeforeTurn, currentPly);
        await coachContext.closeEpisodeIfNeeded(deps, session.id, closedEpisode.messages, currentPly);
        currentPly = jump.ply;
        await sessionsRepo.updateCurrentPly(deps.db, session.id, currentPly);
      }
      await sessionMessagesRepo.insert(deps.db, session.id, 'user', input.content, currentPly);
    }
    if (input.clientToolResult) {
      currentPly = await applyClientToolResult(deps, session, input.clientToolResult, currentPly);
    }

    const { staticPart, dynamicPart } = await buildSystemPromptForSession(deps.db, session);
    const historyAfterTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
    const requestMessages = await coachContext.buildEpisodeContext({
      db: deps.db,
      callLightModel: deps.callLightModel,
      session,
      currentPly,
      historyAfterTurn,
      staticPart,
      dynamicPart
    });

    const tools = buildCoachTools(
      { userId: session.userId, sessionId: session.id, gameId: session.gameId },
      {
        db: deps.db,
        jobQueue: deps.jobQueue,
        analyzePosition: deps.analyzePosition,
        callLightModel: deps.callLightModel
      }
    );
    const requestTools = serializeTools(tools);

    return streamText({
      model: resolution.model,
      messages: requestMessages,
      tools,
      maxSteps: MAX_STEPS,
      onFinish: async (event) => {
        // streamText's response has already been piped to the client by the
        // time this runs (see routes/sessions.ts's reply.hijack()), so nothing
        // downstream can catch a rejection here — an uncaught error would
        // otherwise crash the whole process (seen live: a NaN token count from
        // a provider quirk took down the entire API). Persisting the transcript
        // and metering the call must never be able to do that.
        try {
          const usage = normalizeUsage(resolution.provider, event.usage, event.providerMetadata);

          // Debug snapshot capture is independent of the persistence/metering
          // below — written first so a failure further down never hides it.
          await sessionsRepo.updateDebugSnapshot(deps.db, session.id, {
            request: {
              provider: resolution.provider,
              model: resolution.modelId,
              messages: requestMessages,
              tools: requestTools,
              maxSteps: MAX_STEPS
            },
            response: {
              messages: event.response.messages,
              finishReason: event.finishReason,
              usage,
              providerMetadata: event.providerMetadata
            }
          } satisfies TurnDebugSnapshot);

          // A show_position tool-call inside this turn's own response is the
          // coach *deciding* to move to a new position, before the client
          // round-trip that confirms it (that confirmation lands in a later
          // turn's applyClientToolResult). The assistant message carrying
          // that tool-call must be tagged with the ply it's ABOUT to move
          // to, not the ply that was current when the turn started —
          // otherwise it's tagged old-ply while the eventual tool-result
          // (tagged new-ply, once confirmed) lands one episode later, and
          // buildEpisodeContext's episode scan splits the tool-call from
          // its tool-result across two episodes: a bare tool-result with no
          // matching tool-call in the same request, which Anthropic and
          // OpenAI both reject. moveRefToPly is deterministic from the tool
          // call's own {moveNumber, color} args — no need to wait for the
          // client's confirmed ply, and it always matches what the client
          // later reports (both compute it from the same address).
          let tagPly = currentPly;
          for (const message of event.response.messages) {
            const jumpTargetPly = extractShowPositionTargetPly(message);
            if (jumpTargetPly !== null) tagPly = jumpTargetPly;
            await sessionMessagesRepo.insert(deps.db, session.id, message.role, message.content, tagPly);
          }
          await recordUsage(deps.db, {
            userId: session.userId,
            sessionId: session.id,
            provider: resolution.provider,
            model: resolution.modelId,
            tier: 'standard',
            usage: {
              // Total input tokens (fresh + reused-from-cache) — matches
              // computeCredits' expectation of pre-discount total input.
              // Cache-write tokens are intentionally excluded (billing math
              // for the cache-write premium is out of scope; see design doc).
              inputTokens: usage.freshInputTokens + usage.cacheReadTokens,
              outputTokens: usage.outputTokens,
              cachedInputTokens: usage.cacheReadTokens
            },
            purpose: 'coach_turn',
            metered: resolution.metered
          });
        } catch (error) {
          console.error(`coach-agent onFinish failed for session ${session.id}:`, error);
        } finally {
          releaseOnce();
        }
      }
    });
  } catch (error) {
    releaseOnce();
    throw error;
  }
}
```

`currentEpisode` is imported from `../lib/episodes.js`; `coachContext` is the `import * as coachContext from './coach-context.js';` added above. Everything else in this function body is unchanged from the current file — only the section between the credits check and the `tools`/`streamText` call actually changed (the old two-line `input.content`/`clientToolResult` handling plus the old `buildSystemPromptForSession`/`priorMessages`/`buildCacheableMessages` sequence), and the `onFinish` loop's `sessionMessagesRepo.insert` call gained a fourth argument.

Replace `applyClientToolResult`:

```ts
async function applyClientToolResult(
  deps: CoachAgentDependencies,
  session: SessionRow,
  toolResult: NonNullable<StartTurnInput['clientToolResult']>,
  currentPly: number
): Promise<number> {
  let result = toolResult.result;
  let ply = currentPly;
  if (toolResult.toolName === 'show_position') {
    const { ply: newPly } = toolResult.result as { ply: number };
    if (newPly !== currentPly) {
      const historyBeforeTurn = await sessionMessagesRepo.listBySession(deps.db, session.id);
      const closedEpisode = currentEpisode(historyBeforeTurn, currentPly);
      await coachContext.closeEpisodeIfNeeded(deps, session.id, closedEpisode.messages, currentPly);
    }
    ply = newPly;
    await sessionsRepo.updateCurrentPly(deps.db, session.id, ply);
    result = await withAuthoritativeFen(deps.db, session.gameId, ply, toolResult.result);
  }
  await sessionMessagesRepo.insert(
    deps.db,
    session.id,
    'tool',
    [{ type: 'tool-result', toolCallId: toolResult.toolCallId, toolName: toolResult.toolName, result }],
    ply
  );
  return ply;
}
```

Add the `currentEpisode` import and a `moveRefToPly` import:

```ts
import { moveRefToPly } from '@chess-coach/chess-analysis';
import { currentEpisode } from '../lib/episodes.js';
```

Add the helper `extractShowPositionTargetPly` (used by the `onFinish` loop above), placed near `toCoreMessage`/other small private helpers at the bottom of the file:

```ts
/** The onFinish tagging fix above: reads a show_position tool-call's own
 * {moveNumber, color} args to determine the ply it targets, without
 * waiting for the client's confirming round-trip. Returns null for any
 * message that isn't an assistant message containing a show_position call
 * (the overwhelmingly common case — most turns never move the position). */
function extractShowPositionTargetPly(message: { role: string; content: unknown }): number | null {
  if (!Array.isArray(message.content)) return null;
  for (const part of message.content) {
    if (typeof part !== 'object' || part === null) continue;
    const candidate = part as { type?: unknown; toolName?: unknown; args?: unknown };
    if (candidate.type !== 'tool-call' || candidate.toolName !== 'show_position') continue;
    const args = candidate.args as { moveNumber?: unknown; color?: unknown };
    if (typeof args.moveNumber !== 'number') continue;
    return moveRefToPly(args.moveNumber, (args.color as 'white' | 'black' | null) ?? null);
  }
  return null;
}
```

Delete `buildCacheableMessages` and the private `toCoreMessage` function entirely (both superseded — `toCoreMessage` is now private to `coach-context.ts`, `buildCacheableMessages` is now `coach-context.ts`'s `buildEpisodeMessages`). Confirm nothing else in `coach-agent.ts` still references `toCoreMessage` (it doesn't, after the `priorMessages.map(toCoreMessage)` line — which itself no longer exists — is gone) or `CoreMessage`/`ProviderMetadata` imports that become unused; adjust the `import ... from 'ai'` line accordingly if `CoreMessage` is no longer referenced directly in this file (check — `TurnDebugSnapshot.request.messages: CoreMessage[]` still uses the type, so keep it).

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -w apps/api -- coach-agent.test`
Expected: PASS

- [ ] **Step 5: Run the full API suite and typecheck**

Run: `npm run typecheck -w apps/api && npm test -w apps/api`
Expected: PASS — this also exercises `routes/sessions.test.ts` and `jobs/summarize-session.ts`'s consumers of `sessionMessagesRepo`, which are unaffected by the `ply` parameter being optional.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/coach-agent.ts apps/api/src/services/coach-agent.test.ts
git commit -m "feat: replace whole-transcript replay with episode-scoped five-layer context"
```

---

### Task 13: Update `docs/prompts.md`

**Files:**
- Modify: `docs/prompts.md`

**Interfaces:**
- None (documentation only) — but required by `AGENTS.md` rule 6: "Prompt text lives only in `packages/prompts` and must match `docs/prompts.md` — update both together."

- [ ] **Step 1: Add the two new tools to §2.1's "Your tools and when to use them" text block**

In the fenced prompt-text block in `docs/prompts.md` (§2.1), insert after the `update_threads` bullet and before `end_session`, matching Task 8's actual code text exactly:

```
- record_move_note: whenever you're about to leave a moment, jot a one-sentence
  note on what happened there ("missed Rxd5, discussed the pin, assigned as
  homework") — this is how you'll remember it later without re-reading the whole
  discussion. Discretionary, like record_finding: worth calling most of the time
  you leave a moment, not mechanically every single time.
- recall_move: if the one-line summary of an earlier move (in "Other moves
  discussed" below) isn't enough to answer the student, call this to pull up more
  detail on that specific move.
```

- [ ] **Step 2: Add a new §2.7 documenting the five-layer context assembly**

Insert a new subsection after §2.6 (Injection resistance) and before the `---` separator that ends §2:

```markdown
### 2.7 Context assembly (coach-context.ts)

As of the coach context restructure (docs/superpowers/specs/2026-07-31-coach-
context-restructure-design.md), the request sent to the model each turn is five
layers instead of two, each on its own Anthropic cache breakpoint except the last:

1. **Static** (§2.1's full text) — cached, byte-identical for every turn of every
   session in a rating band.
2. **Dynamic** (student profile, game meta, coaching plan — §2.2) — cached, stable
   for the whole session.
3. **Annotated PGN** — cached, static per game. The whole game as SAN with quality
   symbols inline (`18.Nf3! Bg4?!`); moves classified `mistake`/`blunder`/`miss`/
   `dubious` also get centipawn loss and the best line. Built from
   `classifyMoves()`'s already-computed, already-persisted output
   (`analyses.classified_moves`) — nothing new to compute.
4. **Other moves discussed** — cached, rebuilt every turn from
   `session_move_notes` (excluding the currently open move): one line per
   previously-discussed ply, e.g. `- White's move 18 (blunder): missed Rxd5,
   assigned as homework.` Only busts its own cache entry when a note actually
   changes.
5. **Current position** — uncached (the only layer that changes every turn):
   which move is now on the board, its FEN, where the coach/student arrived from
   if this is a fresh jump, then the backstage thread ledger (§Conversation
   threading), then the current episode's own raw conversation.

An "episode" is the contiguous run of `session_messages` sharing the session's
current ply. Moving to a new position (`show_position`, or the student navigating
the move list and sending a message) closes the old episode: the coach's own
`record_move_note` call for that ply wins if present, otherwise the episode's raw
messages are folded into one automatically. `recall_move` exists for cases where
the one-line summary in layer 4 isn't enough — it re-digests that specific
episode's full raw conversation on demand.
```

- [ ] **Step 3: Verify no other doc references the retired digest columns**

Run: `grep -rn "context_digest\|digestThroughMessageId\|contextDigest" docs/` — confirm no remaining references (the one in `architecture.md` §8.2, if present, documents the *retired* mechanism; leave `architecture.md` as historical unless the user asks for it to be updated too — out of scope for this plan, which only touches `docs/prompts.md` per `AGENTS.md` rule 6).

- [ ] **Step 4: Commit**

```bash
git add docs/prompts.md
git commit -m "docs: document record_move_note/recall_move and the five-layer context assembly"
```

---

## Final verification

- [ ] Run the full suite once more end to end: `npm run lint && npm run typecheck && npm test`
- [ ] Confirm no leftover references to `buildCacheableMessages`, `sessions.contextDigest`, or `sessions.digestThroughMessageId` anywhere in `apps/api/src`: `grep -rn "buildCacheableMessages\|contextDigest\|digestThroughMessageId" apps/api/src`
