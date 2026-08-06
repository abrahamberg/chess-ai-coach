# Mobile Session Layout (Board/Chat Two-View Switch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On phones (<768px), give the board and the chat each a full-height view, switched by tapping a persistent 96px board peek in the chat / a floating chat button on the board.

**Architecture:** `SessionPage` gains a `useMobileSessionView` hook (`'chat' | 'board'`, plus an unread flag). On the mobile branch both the board column and the chat stay mounted; the inactive one carries the `hidden` attribute, so nothing remounts and no state is lost on a switch. The desktop/tablet (≥768px) branch is untouched. The old scroll-driven `useBoardDock` machinery is deleted.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + @testing-library/react (jsdom), plain CSS files colocated with components.

**Spec:** `docs/superpowers/specs/2026-08-06-mobile-session-layout-design.md`

## Global Constraints

- Repo conventions are in `AGENTS.md` and win over general habits. Most relevant here: small named functions over nested conditionals (rule 1); one responsibility per file, target <200 lines, split past ~250 (rule 2); fetching lives in hooks, not components (rule 7).
- Verification command for every task: `npm run lint && npm run typecheck && npm test` from the repo root. It covers every workspace.
- To run just the web tests while iterating: `npm test -w apps/web`.
- All work is in `apps/web`. No API, DB, shared-schema, or package changes.
- This is mobile-only. Anything gated by `useIsBoardSideBySide()` being **true** (≥768px) must behave exactly as it does today. Every existing `SessionPage.test.tsx` test calls `mockMatchMedia(true)` in `beforeEach` and must keep passing unchanged.
- Component files import their own colocated `.css` (e.g. `import './SessionPeekBar.css';`). CSS is not loaded in jsdom, so never assert on computed styles that come from a stylesheet.
- Tests that need to distinguish the active view MUST use `*ByRole` queries. Testing Library's `isInaccessible` check honors the `hidden` attribute directly, so `getByRole` sees only the visible view. `getByText` and `getByTestId` do **not** honor `hidden` and will match both views — do not use them for view assertions.
- Board components are tested with the established `react-chessboard` mock: `vi.mock('react-chessboard', ...)` capturing `props.options`, followed by a dynamic `await import(...)` of the component under test. Copy the pattern from `apps/web/src/features/board/MiniBoard.test.tsx`.
- Commit after every task, using the repo's existing `type: subject` message style (`feat:`, `refactor:`, `test:`, `docs:`).

---

### Task 1: `useMobileSessionView` hook

The view-state primitive. Nothing consumes it yet, so this task is self-contained.

**Files:**
- Create: `apps/web/src/hooks/useMobileSessionView.ts`
- Test: `apps/web/src/hooks/useMobileSessionView.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type MobileSessionView = 'chat' | 'board';
  export interface UseMobileSessionViewResult {
    view: MobileSessionView;
    showBoard: () => void;
    showChat: () => void;
    hasUnread: boolean;
  }
  export function useMobileSessionView(messageCount: number): UseMobileSessionViewResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/useMobileSessionView.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useMobileSessionView } from './useMobileSessionView.js';

function renderView(initialCount = 1) {
  return renderHook(({ count }) => useMobileSessionView(count), { initialProps: { count: initialCount } });
}

describe('useMobileSessionView', () => {
  test('starts on the chat view with nothing unread', () => {
    const { result } = renderView();

    expect(result.current.view).toBe('chat');
    expect(result.current.hasUnread).toBe(false);
  });

  test('showBoard() and showChat() switch the view', () => {
    const { result } = renderView();

    act(() => result.current.showBoard());
    expect(result.current.view).toBe('board');

    act(() => result.current.showChat());
    expect(result.current.view).toBe('chat');
  });

  test('a message arriving while the board is primary raises the unread dot', () => {
    const { result, rerender } = renderView(1);

    act(() => result.current.showBoard());
    rerender({ count: 2 });

    expect(result.current.hasUnread).toBe(true);
  });

  test('returning to the chat clears the unread dot', () => {
    const { result, rerender } = renderView(1);

    act(() => result.current.showBoard());
    rerender({ count: 2 });
    act(() => result.current.showChat());

    expect(result.current.hasUnread).toBe(false);
  });

  test('a message arriving while the chat is already showing never raises the dot', () => {
    const { result, rerender } = renderView(1);

    rerender({ count: 2 });
    rerender({ count: 3 });

    expect(result.current.hasUnread).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- useMobileSessionView`
Expected: FAIL — cannot resolve `./useMobileSessionView.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/hooks/useMobileSessionView.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';

export type MobileSessionView = 'chat' | 'board';

export interface UseMobileSessionViewResult {
  view: MobileSessionView;
  showBoard: () => void;
  showChat: () => void;
  /** True when the coach has produced a message the student hasn't come back
   * to the chat to see — drives the dot on ChatReturnButton. */
  hasUnread: boolean;
}

/** design spec 2026-08-06-mobile-session-layout: which of the two full-height
 * mobile views is showing. Only consumed on the mobile branch of SessionPage,
 * but called unconditionally (hooks rules) — on desktop its value is ignored.
 * Replaces the old scroll-driven useBoardDock. */
export function useMobileSessionView(messageCount: number): UseMobileSessionViewResult {
  const [view, setView] = useState<MobileSessionView>('chat');
  const [lastSeenCount, setLastSeenCount] = useState(messageCount);

  // While the chat is the visible view, everything is by definition seen.
  useEffect(() => {
    if (view === 'chat') setLastSeenCount(messageCount);
  }, [view, messageCount]);

  const showBoard = useCallback(() => setView('board'), []);
  const showChat = useCallback(() => setView('chat'), []);

  return { view, showBoard, showChat, hasUnread: messageCount > lastSeenCount };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- useMobileSessionView`
Expected: PASS, 5 tests.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useMobileSessionView.ts apps/web/src/hooks/useMobileSessionView.test.ts
git commit -m "feat: add useMobileSessionView hook for the mobile board/chat switch"
```

---

### Task 2: Make `MiniBoard` presentational and build `SessionPeekBar`

`MiniBoard` currently renders its own `<button>`. `SessionPeekBar` needs the whole bar to be one button, and nested buttons are invalid HTML, so `MiniBoard` becomes a plain `<div>` thumbnail and the caller owns the interaction. Its only current caller — `SessionBoardColumn`'s docked branch — is removed here, which also drops `showMiniBoard` from `SessionBoardColumn` and `SessionPage`.

**Note on the intermediate state:** between this task and Task 5, mobile has no mini-board at all. That is fine — mobile is already broken (that's the bug being fixed), and every existing test runs the ≥768px path where `showMiniBoard` was always `false` anyway.

**Files:**
- Modify: `apps/web/src/features/board/MiniBoard.tsx`
- Modify: `apps/web/src/features/board/MiniBoard.test.tsx`
- Create: `apps/web/src/features/session/SessionPeekBar.tsx`
- Create: `apps/web/src/features/session/SessionPeekBar.css`
- Test: `apps/web/src/features/session/SessionPeekBar.test.tsx`
- Modify: `apps/web/src/features/session/SessionBoardColumn.tsx` (remove `showMiniBoard` prop + its branch)
- Modify: `apps/web/src/features/session/SessionPage.tsx:90,130` (remove the `showMiniBoard` const and the prop)
- Modify: `apps/web/src/features/session/SessionPage.css:131-138` (move the `.mini-board` rule out)

**Interfaces:**
- Consumes: `MiniBoard`; `describePly`/`sanForPly` from `apps/web/src/features/chat/positionDivider.ts`; `BoardMode` from `apps/web/src/features/session/useSessionBoardState.ts`.
- Produces:
  ```ts
  export interface MiniBoardProps { fen: string; size: number }
  export interface SessionPeekBarProps {
    fen: string;
    ply: number;
    mode: BoardMode;
    sanMoves: string[];
    onShowBoard: () => void;
  }
  export function SessionPeekBar(props: SessionPeekBarProps): ReactNode;
  ```
  The peek bar's accessible name is exactly `Show board`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `apps/web/src/features/board/MiniBoard.test.tsx` (keep the mock header and imports at the top of the file, but drop the now-unused `userEvent` import):

```tsx
describe('MiniBoard', () => {
  test('renders a non-interactive thumbnail at the requested size', () => {
    capturedOptions.length = 0;
    render(<MiniBoard fen={START_FEN} size={96} />);

    const options = capturedOptions.at(-1);
    expect(options?.position).toBe(START_FEN);
    expect(options?.allowDragging).toBe(false);
  });

  test('is not a button — the caller owns the interaction (SessionPeekBar)', () => {
    render(<MiniBoard fen={START_FEN} size={96} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

Create `apps/web/src/features/session/SessionPeekBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { ChessboardOptions } from 'react-chessboard';

const capturedOptions: ChessboardOptions[] = [];

vi.mock('react-chessboard', () => ({
  Chessboard: (props: { options: ChessboardOptions }) => {
    capturedOptions.push(props.options);
    return <div data-testid="mock-chessboard" />;
  }
}));

const { SessionPeekBar } = await import('./SessionPeekBar.js');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SAN_MOVES = ['e4', 'e5', 'Nf3'];

describe('SessionPeekBar', () => {
  test('is a single button that shows the board when tapped', async () => {
    const onShowBoard = vi.fn();
    const user = userEvent.setup();
    render(<SessionPeekBar fen={START_FEN} ply={0} mode="answer" sanMoves={SAN_MOVES} onShowBoard={onShowBoard} />);

    await user.click(screen.getByRole('button', { name: 'Show board' }));

    expect(onShowBoard).toHaveBeenCalledOnce();
  });

  test('shows the current position in the thumbnail', () => {
    capturedOptions.length = 0;
    render(<SessionPeekBar fen={START_FEN} ply={0} mode="answer" sanMoves={SAN_MOVES} onShowBoard={vi.fn()} />);

    expect(capturedOptions.at(-1)?.position).toBe(START_FEN);
  });

  test('captions the game start position', () => {
    render(<SessionPeekBar fen={START_FEN} ply={0} mode="answer" sanMoves={SAN_MOVES} onShowBoard={vi.fn()} />);

    expect(screen.getByText('start position')).toBeInTheDocument();
  });

  test("captions White's move with a dot and Black's with an ellipsis", () => {
    const { rerender } = render(
      <SessionPeekBar fen={START_FEN} ply={1} mode="answer" sanMoves={SAN_MOVES} onShowBoard={vi.fn()} />
    );
    expect(screen.getByText('after 1.e4')).toBeInTheDocument();

    rerender(<SessionPeekBar fen={START_FEN} ply={2} mode="answer" sanMoves={SAN_MOVES} onShowBoard={vi.fn()} />);
    expect(screen.getByText('after 1…e5')).toBeInTheDocument();
  });

  test('peek mode overrides the move caption so the student knows the coach is not watching', () => {
    render(<SessionPeekBar fen={START_FEN} ply={3} mode="peek" sanMoves={SAN_MOVES} onShowBoard={vi.fn()} />);

    expect(screen.getByText('exploring')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w apps/web -- SessionPeekBar MiniBoard`
Expected: FAIL — `SessionPeekBar.js` does not resolve; `MiniBoard` still renders a button.

- [ ] **Step 3: Make `MiniBoard` presentational**

Replace `apps/web/src/features/board/MiniBoard.tsx` entirely:

```tsx
import type { ReactNode } from 'react';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import './MiniBoard.css';

export interface MiniBoardProps {
  fen: string;
  size: number;
}

/** design.md §5.2/§6: a small, never-interactive board thumbnail — no drags,
 * no click handling of its own. Making the surrounding element a button
 * (SessionPeekBar) is the caller's job; owning one here would nest buttons. */
export function MiniBoard({ fen, size }: MiniBoardProps): ReactNode {
  const options: ChessboardOptions = {
    position: fen,
    allowDragging: false
  };

  return (
    <div className="mini-board" style={{ width: size, height: size }}>
      <Chessboard options={options} />
    </div>
  );
}
```

Create `apps/web/src/features/board/MiniBoard.css` with the rule moved out of `SessionPage.css:131-138` (dropping `border`/`background`/`padding`/`align-self`, which only existed because it used to be a button):

```css
.mini-board {
  flex: 0 0 auto;
  border-radius: 8px;
  overflow: hidden;
}
```

Delete the `.mini-board` block from `apps/web/src/features/session/SessionPage.css` (lines 131-138).

- [ ] **Step 4: Write `SessionPeekBar`**

Create `apps/web/src/features/session/SessionPeekBar.tsx`:

```tsx
import type { ReactNode } from 'react';
import { MiniBoard } from '../board/MiniBoard.js';
import { describePly, sanForPly } from '../chat/positionDivider.js';
import type { BoardMode } from './useSessionBoardState.js';
import './SessionPeekBar.css';

const PEEK_BOARD_SIZE = 96;

export interface SessionPeekBarProps {
  fen: string;
  ply: number;
  mode: BoardMode;
  sanMoves: string[];
  onShowBoard: () => void;
}

/** Peek mode means moves aren't reaching the coach — that matters more than
 * which ply is showing, so it wins the caption. */
function peekStatusFor(ply: number, mode: BoardMode, sanMoves: string[]): string {
  if (mode === 'peek') return 'exploring';
  const san = sanForPly(sanMoves, ply);
  if (!san) return 'start position';
  const { moveNumber, color } = describePly(ply);
  return `after ${moveNumber}${color === 'white' ? '.' : '…'}${san}`;
}

/** design spec 2026-08-06-mobile-session-layout: the chat view's persistent
 * board peek. The whole bar is one tap target — tapping it makes the board
 * the primary view. Replaces the old scroll-triggered docked mini-board. */
export function SessionPeekBar({ fen, ply, mode, sanMoves, onShowBoard }: SessionPeekBarProps): ReactNode {
  return (
    <button type="button" className="session-peek-bar" onClick={onShowBoard} aria-label="Show board">
      <MiniBoard fen={fen} size={PEEK_BOARD_SIZE} />
      <span className="session-peek-bar__status">{peekStatusFor(ply, mode, sanMoves)}</span>
    </button>
  );
}
```

Create `apps/web/src/features/session/SessionPeekBar.css`:

```css
/* design spec 2026-08-06-mobile-session-layout: the chat view's board peek. */

.session-peek-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  flex: 0 0 auto;
  padding: 8px 16px;
  background: var(--bg);
  border: none;
  border-bottom: 1px solid rgb(0 0 0 / 8%);
  text-align: left;
}

.session-peek-bar__status {
  font-size: 14px;
  color: var(--text-muted);
}
```

- [ ] **Step 5: Drop `showMiniBoard` from the board column and its caller**

In `apps/web/src/features/session/SessionBoardColumn.tsx`: remove the `showMiniBoard: boolean;` prop from `SessionBoardColumnProps`, remove `showMiniBoard` from the destructured parameter list, remove the now-unused `MiniBoard` import, and collapse the conditional so the real board always renders — replace

```tsx
      {showMiniBoard ? (
        <MiniBoard fen={fen} size={96} onExpand={boardState.expandDock} />
      ) : (
        <div className="session-board-row">
          …
        </div>
      )}
```

with the `<div className="session-board-row">…</div>` block alone, unchanged inside.

In `apps/web/src/features/session/SessionPage.tsx`: delete the `const showMiniBoard = !isSideBySide && boardState.isDocked;` line (line 90) and the `showMiniBoard={showMiniBoard}` prop (line 130).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w apps/web -- SessionPeekBar MiniBoard SessionPage SessionBoardColumn`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/board/MiniBoard.tsx apps/web/src/features/board/MiniBoard.css \
        apps/web/src/features/board/MiniBoard.test.tsx \
        apps/web/src/features/session/SessionPeekBar.tsx apps/web/src/features/session/SessionPeekBar.css \
        apps/web/src/features/session/SessionPeekBar.test.tsx \
        apps/web/src/features/session/SessionBoardColumn.tsx \
        apps/web/src/features/session/SessionPage.tsx apps/web/src/features/session/SessionPage.css
git commit -m "feat: add SessionPeekBar and make MiniBoard a presentational thumbnail"
```

---

### Task 3: `ChatReturnButton`

The floating chat affordance shown while the board is primary.

**Files:**
- Create: `apps/web/src/features/session/ChatReturnButton.tsx`
- Create: `apps/web/src/features/session/ChatReturnButton.css`
- Test: `apps/web/src/features/session/ChatReturnButton.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface ChatReturnButtonProps { hasUnread: boolean; onShowChat: () => void }
  export function ChatReturnButton(props: ChatReturnButtonProps): ReactNode;
  ```
  Accessible name is exactly `Show chat`; the unread dot carries `data-testid="chat-unread-dot"`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/session/ChatReturnButton.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ChatReturnButton } from './ChatReturnButton.js';

describe('ChatReturnButton', () => {
  test('returns to the chat when tapped', async () => {
    const onShowChat = vi.fn();
    const user = userEvent.setup();
    render(<ChatReturnButton hasUnread={false} onShowChat={onShowChat} />);

    await user.click(screen.getByRole('button', { name: 'Show chat' }));

    expect(onShowChat).toHaveBeenCalledOnce();
  });

  test('shows no dot when the student has seen everything', () => {
    render(<ChatReturnButton hasUnread={false} onShowChat={vi.fn()} />);

    expect(screen.queryByTestId('chat-unread-dot')).not.toBeInTheDocument();
  });

  test('shows a dot when the coach has spoken since the student left the chat', () => {
    render(<ChatReturnButton hasUnread onShowChat={vi.fn()} />);

    expect(screen.getByTestId('chat-unread-dot')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- ChatReturnButton`
Expected: FAIL — cannot resolve `./ChatReturnButton.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/features/session/ChatReturnButton.tsx`:

```tsx
import type { ReactNode } from 'react';
import './ChatReturnButton.css';

export interface ChatReturnButtonProps {
  hasUnread: boolean;
  onShowChat: () => void;
}

/** design spec 2026-08-06-mobile-session-layout: while the board owns the
 * mobile screen, the coach collapses to this one floating control. A dot —
 * never a preview, a ticker, or an auto-switch — signals a new message. */
export function ChatReturnButton({ hasUnread, onShowChat }: ChatReturnButtonProps): ReactNode {
  return (
    <button type="button" className="chat-return-button" onClick={onShowChat} aria-label="Show chat">
      <span aria-hidden="true">💬</span>
      {hasUnread && <span className="chat-return-button__dot" data-testid="chat-unread-dot" />}
    </button>
  );
}
```

Create `apps/web/src/features/session/ChatReturnButton.css`. `bottom` clears the 56px bottom tab bar (`AppShell.css`) plus its safe-area inset:

```css
/* design spec 2026-08-06-mobile-session-layout: the board view's chat affordance. */

.chat-return-button {
  position: fixed;
  right: 16px;
  bottom: calc(72px + env(safe-area-inset-bottom));
  z-index: 2;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 22px;
  line-height: 1;
  box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
}

.chat-return-button__dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--annotate-1);
  border: 2px solid var(--accent);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- ChatReturnButton`
Expected: PASS, 3 tests.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/session/ChatReturnButton.tsx \
        apps/web/src/features/session/ChatReturnButton.css \
        apps/web/src/features/session/ChatReturnButton.test.tsx
git commit -m "feat: add ChatReturnButton for the mobile board view"
```

---

### Task 4: `isVisible` on `ChatPane` / `MessageList`

A hidden element has `scrollHeight === 0`, so `MessageList`'s auto-scroll effect is a no-op while the chat is hidden. Without this, messages that stream in during board view leave the transcript scrolled to the top when the student comes back. Purely additive — `isVisible` defaults to `true`, so no existing call site changes.

**Files:**
- Modify: `apps/web/src/features/chat/MessageList.tsx:96-131`
- Modify: `apps/web/src/features/chat/ChatPane.tsx`
- Test: `apps/web/src/features/chat/MessageList.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MessageListProps.isVisible?: boolean` (default `true`) and `ChatPaneProps.isVisible?: boolean` (default `true`, forwarded to `MessageList`).

- [ ] **Step 1: Write the failing test**

Append to the `describe('MessageList', …)` block in `apps/web/src/features/chat/MessageList.test.tsx`:

```tsx
  test('scrolls to the bottom when it becomes visible again (a hidden list has scrollHeight 0, so the normal effect cannot)', () => {
    const { rerender } = render(<MessageList messages={[msg('m1', 'hello')]} isVisible={false} />);
    const container = screen.getByTestId('message-list');
    setScrollGeometry(container, { scrollTop: 100, scrollHeight: 120, clientHeight: 20 }); // at bottom
    vi.mocked(container.scrollTo).mockClear();

    rerender(<MessageList messages={[msg('m1', 'hello')]} isVisible />);

    expect(container.scrollTo).toHaveBeenCalled();
  });

  test('does not yank a list the student had scrolled up before it was hidden', () => {
    const { rerender } = render(<MessageList messages={[msg('m1', 'hello')]} isVisible={false} />);
    const container = screen.getByTestId('message-list');
    setScrollGeometry(container, { scrollTop: 0, scrollHeight: 500, clientHeight: 20 }); // scrolled way up
    fireEvent.scroll(container);
    vi.mocked(container.scrollTo).mockClear();

    rerender(<MessageList messages={[msg('m1', 'hello')]} isVisible />);

    expect(container.scrollTo).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- MessageList`
Expected: FAIL — the first new test's `scrollTo` is never called (no visibility effect exists), and TypeScript rejects the unknown `isVisible` prop.

- [ ] **Step 3: Implement in `MessageList`**

In `apps/web/src/features/chat/MessageList.tsx`, add to `MessageListProps`:

```ts
  /** False while the mobile board view is showing and this list carries the
   * `hidden` attribute. A hidden element reports scrollHeight 0, so the
   * auto-scroll effect below silently does nothing — this flag lets the list
   * catch up the moment it is shown again (design spec
   * 2026-08-06-mobile-session-layout). Defaults to true for every other
   * caller. */
  isVisible?: boolean;
```

Destructure it with `isVisible = true`, add `useRef` to the existing `react` import if not already there (it is), and add this effect immediately after the existing `useEffect` on `[messages]`:

```ts
  const wasVisibleRef = useRef(isVisible);

  useEffect(() => {
    const el = containerRef.current;
    const becameVisible = isVisible && !wasVisibleRef.current;
    wasVisibleRef.current = isVisible;
    if (el && becameVisible && isAtBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [isVisible]);
```

Declare `wasVisibleRef` next to the other refs at the top of the component, not inline before the effect.

- [ ] **Step 4: Forward it from `ChatPane`**

In `apps/web/src/features/chat/ChatPane.tsx`, add to `ChatPaneProps`:

```ts
  /** False while the mobile board view is showing — forwarded to MessageList
   * so it can re-scroll to the bottom when the chat comes back. */
  isVisible?: boolean;
```

Destructure with `isVisible = true` and pass `isVisible={isVisible}` to `<MessageList …>`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w apps/web -- MessageList ChatPane`
Expected: PASS.

- [ ] **Step 6: Full verification**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/chat/MessageList.tsx apps/web/src/features/chat/MessageList.test.tsx \
        apps/web/src/features/chat/ChatPane.tsx
git commit -m "fix: re-scroll the chat to the bottom when it becomes visible again"
```

---

### Task 5: Wire the two-view switch into `SessionPage`

The task that actually fixes the bug. Introduces `MobileSessionBody`, keeps the desktop arm inline and untouched.

**Files:**
- Create: `apps/web/src/features/session/MobileSessionBody.tsx`
- Modify: `apps/web/src/features/session/SessionPage.tsx`
- Modify: `apps/web/src/features/session/SessionPage.css:112-138`
- Modify: `apps/web/src/styles/base.css`
- Test: `apps/web/src/features/session/SessionPage.test.tsx`

**Interfaces:**
- Consumes: `useMobileSessionView` (Task 1), `SessionPeekBar` (Task 2), `ChatReturnButton` (Task 3), `ChatPaneProps.isVisible` (Task 4).
- Produces:
  ```ts
  export interface MobileSessionBodyProps {
    view: MobileSessionView;
    showBoard: () => void;
    showChat: () => void;
    hasUnread: boolean;
    peekFen: string;
    peekPly: number;
    peekMode: BoardMode;
    sanMoves: string[];
    board: ReactNode;
    chat: ReactNode;
  }
  export function MobileSessionBody(props: MobileSessionBodyProps): ReactNode;
  ```

- [ ] **Step 1: Write the failing tests**

Append to the `describe('SessionPage', …)` block in `apps/web/src/features/session/SessionPage.test.tsx`. Note `mockMatchMedia(false)` — both the 768px and 1080px queries report false, i.e. a phone. These use `*ByRole` deliberately: `hidden` subtrees are excluded from role queries but *not* from `getByText`/`getByTestId`.

```tsx
  test('mobile: the chat is the default view, with the board reduced to a tappable peek', async () => {
    mockMatchMedia(false);
    vi.stubGlobal('fetch', mockFetch());
    renderSessionPage();

    expect(await screen.findByRole('button', { name: 'Show board' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /reply/i })).toBeInTheDocument();
    // The full board view's controls belong to the hidden half.
    expect(screen.queryByRole('button', { name: /explore on your own/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show chat' })).not.toBeInTheDocument();
  });

  test('mobile: tapping the peek makes the board primary and collapses the chat to a button', async () => {
    mockMatchMedia(false);
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    renderSessionPage();

    await user.click(await screen.findByRole('button', { name: 'Show board' }));

    expect(screen.getByRole('button', { name: /explore on your own/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show chat' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /reply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show board' })).not.toBeInTheDocument();
  });

  test('mobile: the chat button goes back, and nothing was remounted in between', async () => {
    mockMatchMedia(false);
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    renderSessionPage();

    await user.click(await screen.findByRole('button', { name: 'Show board' }));
    await user.click(screen.getByRole('button', { name: 'Show chat' }));

    expect(screen.getByRole('textbox', { name: /reply/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show board' })).toBeInTheDocument();
    // Proof that both halves stay mounted: getAllByTestId ignores `hidden`, so
    // it sees the peek thumbnail AND the full board at the same time, in both
    // views. If either half were conditionally rendered this would be 1.
    expect(screen.getAllByTestId('mock-chessboard')).toHaveLength(2);
  });

  test('at or above 768px both the board and the chat are visible at once (no switch)', async () => {
    mockMatchMedia(true);
    vi.stubGlobal('fetch', mockFetch());
    renderSessionPage();

    await screen.findByTestId('mock-chessboard');
    expect(screen.getByRole('textbox', { name: /reply/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show board' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show chat' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w apps/web -- SessionPage`
Expected: FAIL — no "Show board" button exists; the existing `mockMatchMedia(true)` tests still pass.

- [ ] **Step 3: Add the `[hidden]` override**

In `apps/web/src/styles/base.css`, add immediately after the `box-sizing` reset block at the top:

```css
/* `hidden` is a UA-stylesheet `display: none`, which loses to any component
 * rule that sets `display: flex` — and the mobile session views are exactly
 * that (design spec 2026-08-06-mobile-session-layout). Without this, hiding
 * a view does nothing on screen. */
[hidden] {
  display: none !important;
}
```

- [ ] **Step 4: Write `MobileSessionBody`**

Create `apps/web/src/features/session/MobileSessionBody.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { MobileSessionView } from '../../hooks/useMobileSessionView.js';
import { ChatReturnButton } from './ChatReturnButton.js';
import { SessionPeekBar } from './SessionPeekBar.js';
import type { BoardMode } from './useSessionBoardState.js';

export interface MobileSessionBodyProps {
  view: MobileSessionView;
  showBoard: () => void;
  showChat: () => void;
  hasUnread: boolean;
  peekFen: string;
  peekPly: number;
  peekMode: BoardMode;
  sanMoves: string[];
  board: ReactNode;
  chat: ReactNode;
}

/** design spec 2026-08-06-mobile-session-layout: below 768px the board and
 * the chat are two full-height views rather than a stack, because stacking
 * them left the chat with almost no room on a phone. Both halves stay
 * mounted and the inactive one is `hidden` — remounting would throw away
 * chat scroll position, the Explore panel's engine analysis, and
 * react-chessboard's internal state on every switch. */
export function MobileSessionBody({
  view,
  showBoard,
  showChat,
  hasUnread,
  peekFen,
  peekPly,
  peekMode,
  sanMoves,
  board,
  chat
}: MobileSessionBodyProps): ReactNode {
  return (
    <div className="session-body mobile">
      <div className="session-mobile-view session-mobile-view--chat" hidden={view !== 'chat'}>
        <SessionPeekBar fen={peekFen} ply={peekPly} mode={peekMode} sanMoves={sanMoves} onShowBoard={showBoard} />
        {chat}
      </div>
      <div className="session-mobile-view session-mobile-view--board" hidden={view !== 'board'}>
        {board}
        <ChatReturnButton hasUnread={hasUnread} onShowChat={showChat} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rework `SessionPage`**

In `apps/web/src/features/session/SessionPage.tsx`:

Add imports:

```ts
import { useMobileSessionView } from '../../hooks/useMobileSessionView.js';
import { MobileSessionBody } from './MobileSessionBody.js';
```

Call the hook alongside the existing ones (after `useSessionPageData`, so `chat` is in scope). It is called unconditionally per the rules of hooks; its value is only used on the mobile branch:

```ts
  const mobileView = useMobileSessionView(chat.messages.length);
```

Then, after the existing `const fen = divergedLine.fen ?? boardState.fen;`, build the two halves as nodes so both branches share them verbatim:

```tsx
  const isChatVisible = isSideBySide || mobileView.view === 'chat';

  const boardNode = (
    <SessionBoardColumn
      boardState={boardState}
      divergedLine={divergedLine}
      currentRealPosition={currentRealPosition}
      orientation={orientation}
      sanMoves={sanMoves}
      positions={positions}
      classifiedMoves={gameQuery.data?.classifiedMoves}
      isDesktop={isDesktop}
      engine={engine}
      autoplayIntervalMs={autoplayIntervalMs}
      onChangeAutoplayInterval={setAutoplayIntervalMs}
      sendMessage={(content) => void chat.sendMessage(content)}
      onArrowsChange={setBoardArrows}
      hoverMove={hoverMove}
    />
  );

  const chatNode =
    session.status === 'paused_no_credits' ? (
      <div className="session-paused-card">
        <p>The session is saved. Add credits or your own API key to continue.</p>
        <button type="button" onClick={() => navigate('/settings')}>
          Add credits
        </button>
      </div>
    ) : (
      <ChatPane
        sessionId={sessionId}
        messages={chat.messages}
        activeToolName={chat.activeToolName}
        isThinking={chat.isThinking}
        onSend={handleSendMessage}
        onScrollUp={boardState.collapseDock}
        onSelectPly={peekAt}
        boardArrows={boardArrows}
        hasPendingLine={Boolean(divergedLine.line)}
        fen={fen}
        positions={positions}
        onHoverMove={setHoverMove}
        isVisible={isChatVisible}
      />
    );
```

(`onScrollUp` stays for now — Task 6 removes it along with the rest of the dock.)

Replace the returned `<div className={isSideBySide ? … }>…</div>` block with:

```tsx
      {isSideBySide ? (
        <div className="session-body desktop">
          {isDesktop &&
            (divergedLine.line ? (
              <DivergedLinePanel
                line={divergedLine.line}
                stepIndex={divergedLine.stepIndex}
                onSelectStep={divergedLine.previewStep}
                onExit={divergedLine.exit}
                autoplayIntervalMs={autoplayIntervalMs}
                onChangeAutoplayInterval={setAutoplayIntervalMs}
              />
            ) : (
              <MoveExplorer
                sanMoves={sanMoves}
                classifiedMoves={gameQuery.data?.classifiedMoves ?? []}
                positions={positions}
                currentPly={boardState.ply}
                onSelect={peekAt}
              />
            ))}
          {boardNode}
          {chatNode}
        </div>
      ) : (
        <MobileSessionBody
          view={mobileView.view}
          showBoard={mobileView.showBoard}
          showChat={mobileView.showChat}
          hasUnread={mobileView.hasUnread}
          peekFen={fen}
          peekPly={boardState.ply}
          peekMode={boardState.mode}
          sanMoves={sanMoves}
          board={boardNode}
          chat={chatNode}
        />
      )}
```

Note the `MoveExplorer`/`DivergedLinePanel` third column is inside the desktop branch only, exactly as before (it was already gated on `isDesktop`, which is a strict subset of `isSideBySide`).

- [ ] **Step 6: Update the mobile CSS**

In `apps/web/src/features/session/SessionPage.css`, replace the `/* --- mobile / tablet: board docked top, chat scrolls below --- */` section (lines 112-129, i.e. the three `.session-body.mobile …` rules; the `.mini-board` rule below it was already moved out in Task 2) with:

```css
/* --- mobile (<768px): two full-height views, one visible at a time ---
 * design spec 2026-08-06-mobile-session-layout. Stacking the board above the
 * chat left the chat unusable on a phone; each now owns the screen and the
 * peek bar / chat button switch between them. Both stay mounted — the
 * inactive one is `hidden` (see base.css's [hidden] override, which is
 * required to beat the `display: flex` below). */
.session-body.mobile {
  flex: 1;
  min-height: 0;
}

.session-mobile-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.session-mobile-view--chat .chat-pane {
  flex: 1;
  min-height: 0;
}

/* Short viewports (e.g. iPhone SE, 667px) must scroll the board column
 * rather than clip the move strip and Explore toggle off the bottom. */
.session-mobile-view--board .session-board-column {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -w apps/web -- SessionPage`
Expected: PASS — the four new tests plus every pre-existing one.

- [ ] **Step 8: Full verification**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/session/MobileSessionBody.tsx \
        apps/web/src/features/session/SessionPage.tsx \
        apps/web/src/features/session/SessionPage.css \
        apps/web/src/features/session/SessionPage.test.tsx \
        apps/web/src/styles/base.css
git commit -m "feat: give the mobile session board and chat their own full-height views"
```

---

### Task 6: Delete the dock

The scroll-driven docking machinery is now dead code. Removing it is what makes this change a net simplification rather than another layer.

**Files:**
- Delete: `apps/web/src/hooks/useBoardDock.ts`
- Delete: `apps/web/src/hooks/useBoardDock.test.ts`
- Modify: `apps/web/src/features/session/useSessionBoardState.ts`
- Modify: `apps/web/src/features/session/useSessionBoardState.test.ts:20-24,84-106`
- Modify: `apps/web/src/features/chat/ChatPane.tsx`
- Modify: `apps/web/src/features/chat/MessageList.tsx`
- Modify: `apps/web/src/features/session/SessionPage.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `UseSessionBoardStateResult` loses `isDocked`, `collapseDock`, `expandDock`. `ChatPaneProps` and `MessageListProps` lose `onScrollUp`. No other field changes.

- [ ] **Step 1: Update the tests first**

In `apps/web/src/features/session/useSessionBoardState.test.ts`:
- Line 20: rename the test to `'starts at ply 0 with no annotations'` and delete the `expect(result.current.isDocked).toBe(false);` assertion (line 24).
- Line 84: rename the test to `'a show_position tool call updates the fen and clears annotations'`, and delete the `act(() => { result.current.collapseDock(); })` block, the `expect(result.current.isDocked).toBe(true);` line, and the trailing `expect(result.current.isDocked).toBe(false);` line. Keep every fen/annotation assertion.

Delete `apps/web/src/hooks/useBoardDock.test.ts`.

In `apps/web/src/features/chat/MessageList.test.tsx` and `apps/web/src/features/chat/ChatPane.test.tsx`, remove any test or assertion referencing `onScrollUp`. Find them first:

```bash
grep -rn "onScrollUp\|collapseDock\|expandDock\|isDocked" apps/web/src
```

- [ ] **Step 2: Run the tests to confirm they still pass**

Run: `npm test -w apps/web -- useSessionBoardState MessageList ChatPane`
Expected: PASS. Unlike the earlier tasks this is a removal, not a new behavior, so there is no red phase — Step 1 only deleted assertions about behavior that is about to disappear. The real gates are Step 4 (no references remain) and Step 5 (typecheck, which is what catches a missed removal).

- [ ] **Step 3: Remove the implementation**

Delete `apps/web/src/hooks/useBoardDock.ts`.

In `apps/web/src/features/session/useSessionBoardState.ts`:
- Remove the `import { useBoardDock } from '../../hooks/useBoardDock.js';` line.
- Remove `const dock = useBoardDock();`.
- Remove `isDocked`, `collapseDock`, `expandDock` from `UseSessionBoardStateResult` and from the returned object.
- Remove both `dock.expand();` calls inside `handleToolCall`, and drop `dock` from that `useCallback`'s dependency array (leaving `[annotations]`).
- Update the JSDoc above the hook: `show_position` no longer "auto-expands a docked mini-board". Replace that clause so it reads:

```
 * Owns the board-facing consequences of the coach's tool calls (architecture
 * §7.1): show_position moves the board, clearing any prior annotations
 * (design.md §5.4); annotate_board sets arrows/highlights. Neither changes
 * which mobile view is showing — the chat's peek bar reflects the new
 * position in place (design spec 2026-08-06-mobile-session-layout). Both are
 * client tools, so their return value here becomes the tool result
 * useCoachChat posts back.
```

In `apps/web/src/features/chat/MessageList.tsx`:
- Remove `onScrollUp?: () => void;` and its doc comment from `MessageListProps`.
- Remove `onScrollUp` from the destructured parameters.
- In `handleScroll`, delete the `if (!isAtBottomRef.current) onScrollUp?.();` line. The function keeps updating `isAtBottomRef`, which the auto-scroll effects still need.

In `apps/web/src/features/chat/ChatPane.tsx`:
- Remove `onScrollUp?: () => void;` from `ChatPaneProps`, from the destructured parameters, and from the `<MessageList …>` call.

In `apps/web/src/features/session/SessionPage.tsx`:
- Remove `onScrollUp={boardState.collapseDock}` from the `ChatPane` in `chatNode`.

- [ ] **Step 4: Verify nothing references the dock**

Run: `grep -rn "onScrollUp\|collapseDock\|expandDock\|isDocked\|useBoardDock" apps/web/src`
Expected: no output.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src
git commit -m "refactor: delete the scroll-driven board dock, superseded by the mobile view switch"
```

---

### Task 7: Docs and live browser verification

Green tests are not evidence that a layout works — the bug being fixed here is precisely one no unit test caught. This task is not done until the app has been driven in a real browser at phone size.

**Files:**
- Modify: `docs/design.md:95` (§3.1 table), `docs/design.md:189-227` (§5.2), `docs/design.md:288-296` (§5.6)

- [ ] **Step 1: Update §3.1's breakpoint table**

In `docs/design.md`, change the `mobile` row's session-layout cell from `stacked: board docked top, chat below (§5.2)` to `two full-height views, board ⇄ chat (§5.2)`. Leave the `tablet` and `desktop` rows alone.

- [ ] **Step 2: Rewrite §5.2**

Replace the §5.2 body (from `**Board docked top, chat scrolls beneath.**` through the `Keyboard-open state:` bullet) with the following. Note that it answers the original "rejected alternatives" note head-on rather than quietly dropping it — the objection to tabs was real, and the peek bar is what resolves it:

````markdown
**Two full-height views — chat (default) and board — switched by tapping.**
Stacking board over chat (the original design) left ~200px for the chat on a
360×640 phone in theory and effectively nothing in practice: the board column
also carries the eval bar, contextual pills, the move strip, and the Explore
toggle. The scroll-triggered mini-board dock that was meant to relieve it was
unreachable, since it required scrolling a chat you couldn't see.

Tabs were previously rejected here because "you can't read a question and see
the position". The persistent 96px peek bar is what answers that: the position
is always on screen in the chat view, and the board is one tap away.

```
   chat view (default)              board view
┌────────────────────────────┐  ┌────────────────────────────┐
│ ◀  Marta vs. daniel   ⋯    │  │ ◀  Marta vs. daniel   ⋯    │
├────────────────────────────┤  ├────────────────────────────┤
│ ┌────┐  after 14…Nf3       │  │ ▐                          │
│ │mini│  ← tap: show board   │  │ ▐        BOARD             │
│ └────┘                     │  │ ▐                          │
├────────────────────────────┤  ├────────────────────────────┤
│ ┌────────────────────────┐ │  │ 1. e4 e5 2. ♘f3 …          │
│ │ Coach: what did you    │ │  ├────────────────────────────┤
│ │ want your pieces to…   │ │  │ [ Explore on your own ]    │
│ └────────────────────────┘ │  │                            │
│         ┌────────────────┐ │  │                     ┌────┐ │
│         │ I wanted to…   │ │  │                     │ 💬•│ │
│         └────────────────┘ │  │                     └────┘ │
├────────────────────────────┤  │        ↑ tap: show chat    │
│ [type a reply…      Send ] │  │                            │
└────────────────────────────┘  └────────────────────────────┘
```

- The peek bar's caption is `start position` / `after 14…Nf3`, or `exploring`
  while in peek mode.
- While the board is primary the coach is a floating button with an unread
  dot — no ticker, no toast, and **no auto-switch**: `show_position` and
  `annotate_board` move the board, and the peek reflects that in place.
- Both views stay mounted (the inactive one is `hidden`), so switching never
  loses chat scroll position, the Explore panel's engine analysis, or the
  board's internal state.
- Landscape phones get the tablet side-by-side layout.
- Keyboard-open state needs no special handling — the chat view's board is
  already the 96px peek.
````

- [ ] **Step 3: Correct §5.6**

In §5.6, change `Collapsed by default under the board (desktop) / behind the ⋯ menu (mobile)` to `Collapsed by default under the board, on both desktop and the mobile board view`. The ⋯ menu was never built, and the mobile board view now has room for the toggle inline.

- [ ] **Step 4: Start the stack**

Run: `npm run dev`
Wait for the web-dev container to serve. Confirm the port from the compose output (`docker compose ps` if unsure).

- [ ] **Step 5: Drive it at phone size**

Open the app in a browser at a 390×844 viewport (Chrome DevTools device toolbar, or the `claude-in-chrome` tools with `resize_window`), navigate into an active session, and confirm each of these by eye:

1. The chat lands first: message bubbles and the reply input are visible without scrolling, and the peek bar sits above them showing the current position.
2. Tapping the peek bar switches to the board: full board, move strip, and the Explore toggle all visible and not clipped.
3. The floating 💬 button is above the bottom tab bar, not behind it.
4. Tapping 💬 returns to the chat with the scroll position preserved — not jumped to the top.
5. Send a message; while the coach is streaming, switch to the board, let it finish, then switch back. The transcript is scrolled to the newest message, and the 💬 button showed its unread dot while you were on the board.
6. Repeat at 360×640 (a small Android) and confirm the board view scrolls rather than clipping the Explore toggle.

If any of these fails, fix it and re-run `npm run lint && npm run typecheck && npm test` before continuing.

- [ ] **Step 6: Stop the stack**

Run: `npm run dev:down`

- [ ] **Step 7: Commit**

```bash
git add docs/design.md
git commit -m "docs: describe the mobile session two-view layout in design.md"
```
