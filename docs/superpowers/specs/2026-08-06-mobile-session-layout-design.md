# Mobile session layout — board/chat two-view switch — design

Status: approved, ready for implementation planning.

## Problem

On a phone the session screen is unusable: the chat is effectively invisible.

`SessionPage` renders a sticky `.session-board-column` above the chat whenever
`useIsBoardSideBySide()` is false (<768px). That column stacks the eval bar, a
full-width `CoachBoard` (~366px tall on a 390px-wide phone), any contextual
pills, the `MoveStrip`, and the "Explore on your own" toggle — roughly 500px.
Add `SessionHeader` (~56px) and the fixed 56px bottom tab bar and there is
almost no room left for `ChatPane`, which is the surface the entire product is
built around.

The existing escape hatch does not help. `useBoardDock` collapses the board to
a 96px `MiniBoard`, but only when `MessageList` reports a scroll-up — and you
cannot scroll a chat you cannot see. The affordance is unreachable from the
broken state it is meant to fix.

`docs/design.md` §5.6 also says the Explore panel belongs behind a ⋯ menu on
mobile; it is rendered inline instead. That drift is resolved below (in favor
of the current inline behavior, deliberately).

## Goal

Board and chat each get the full screen on mobile, with a one-tap switch
between them and no loss of context in either direction.

## Scope decisions (from brainstorming)

- **Mobile only.** At ≥768px `useIsBoardSideBySide()` is true and the
  side-by-side layout is unchanged. Desktop (≥1080px, three columns with
  `MoveExplorer`) is likewise untouched.
- **Board and chat are equal partners**, not primary/secondary. Each gets a
  full-height screen rather than a split.
- **The mini-board is the switch.** Tapping the board peek in the chat view
  makes the board primary; a chat icon in the board view goes back. No
  segmented control, no swipe (design.md §5.5 already reserves horizontal
  swipe on the board for prev/next move), no bottom sheet.
- **A persistent board peek stays in the chat view.** Position context is
  never lost while reading the coach.
- **While the board is primary, the coach is an icon plus an unread dot.** No
  ticker, no toast, no auto-switch.
- **The board view keeps everything it shows today** — move strip and Explore
  panel included. It now owns the full screen, so there is room. This
  supersedes design.md §5.6's "behind the ⋯ menu (mobile)".
- **Both views stay mounted**, toggled by visibility. Remounting on every
  switch is what makes a switch feel like a page load.

## Design

### View state

A new hook `apps/web/src/hooks/useMobileSessionView.ts` replaces
`useBoardDock`:

```ts
export interface UseMobileSessionViewResult {
  view: 'chat' | 'board';   // default 'chat'
  showBoard: () => void;
  showChat: () => void;
  hasUnread: boolean;
}

export function useMobileSessionView(messageCount: number): UseMobileSessionViewResult;
```

`hasUnread` is `messageCount > lastSeenCount`. `lastSeenCount` resyncs to
`messageCount` in an effect whenever `view === 'chat'`, so the dot appears only
for messages that arrived while the board was primary and clears the moment
the student returns to the chat. `isThinking` does not raise the dot — only a
new message does.

The hook is unconditional (hooks cannot be called conditionally), but its
result is only consumed on the mobile branch of `SessionPage`.

### What is deleted

This change is a net simplification of the docking machinery:

- `apps/web/src/hooks/useBoardDock.ts` and its test — removed.
- `isDocked` / `collapseDock` / `expandDock` from
  `useSessionBoardState`'s result and its `dock` usage — removed, including
  both `dock.expand()` calls inside `handleToolCall`.
- `showMiniBoard` prop on `SessionBoardColumn` and its `MiniBoard` branch —
  removed. The board column is now always the real board.
- `onScrollUp` on `ChatPane`, and the scroll-up detection it feeds in
  `MessageList` (`MessageList.tsx:81`) — removed.

Per the "peek, don't auto-switch" decision, `show_position` and
`annotate_board` no longer influence which view is showing. They move the
board, and the chat view's peek reflects that immediately.

### Chat view (default)

```
SessionHeader
┌────────────────────────────────┐
│ [96px mini]  after 12…Nf3      │  ← .session-peek-bar (sticky, tappable)
├────────────────────────────────┤
│ MessageList (flex: 1)          │
│ …                              │
├────────────────────────────────┤
│ composer                       │
└────────────────────────────────┘
```

New component `apps/web/src/features/session/SessionPeekBar.tsx`: a `MiniBoard`
at 96px plus a one-line status. The whole bar is one button
(`aria-label="Show board"`) that calls `showBoard()`.

Status line text, in priority order:

1. `exploring` — when `boardState.mode === 'peek'`.
2. `after <n><…><san>` — derived from `describePly`/`sanForPly`
   (`features/chat/positionDivider.ts`), the same helpers
   `SessionBoardColumn` already uses for its pills.
3. `start position` — at ply 0.

The contextual pills (undo, "⟲ back to coach", "reveal →") stay on the board
view only. The status line is what signals that something is active; one tap
reaches the pill itself.

### Board view

`SessionBoardColumn` exactly as it renders today — eval bar + `CoachBoard` +
pills + `MoveStrip` + `ExplorePanel`/`DivergedLinePanel` — at full height,
with `overflow-y: auto` so a short viewport (e.g. iPhone SE, 667px) scrolls
rather than clips.

Plus a new `apps/web/src/features/session/ChatReturnButton.tsx`: a 56px
circular button fixed bottom-right (`bottom: 72px` to clear the 56px tab bar
plus safe area, `right: 16px`), accent background, chat glyph,
`aria-label="Show chat"`, rendering an unread dot when `hasUnread`.

### Mount strategy

Both `SessionBoardColumn` and `ChatPane` stay mounted on mobile. The inactive
one carries the `hidden` attribute. Nothing remounts, so chat scroll position,
`MessageList` state, `ExplorePanel`'s in-browser engine analysis, and
`react-chessboard`'s internals all survive a switch.

Two consequences must be handled explicitly or the feature will look done and
be broken:

1. **`hidden` loses the specificity fight.** It is a UA-stylesheet
   `display: none`, which is overridden by `.session-board-column { display:
   flex }` and `.chat-pane { display: flex }`. `styles/base.css` needs an
   explicit `[hidden] { display: none !important; }`.
2. **Hidden elements have `scrollHeight === 0`,** so `MessageList`'s
   auto-scroll (`MessageList.tsx:120-127`) is a no-op while the chat is
   hidden — messages that stream in during board view would leave the
   transcript scrolled to the top. `ChatPane` takes an `isVisible: boolean`
   prop (default `true`, so the desktop call site is unaffected) and passes it
   to `MessageList`, which re-runs its scroll-to-bottom on the false→true
   transition when `isAtBottomRef.current` is set.

`hidden` also removes the subtree from the accessibility tree, so
Testing Library's `getByRole` queries naturally see only the active view.

### SessionPage composition

`SessionPage` stays presentational (AGENTS.md rule 7 — fetching lives in
`useSessionPageData`). The mobile branch gains the view flag and two small
components; the desktop branch is byte-for-byte what it is today. Per AGENTS.md
rule 2 (one responsibility, <200 lines), if threading the mobile branch pushes
`SessionPage.tsx` past ~200 lines, the mobile arm is extracted to
`features/session/MobileSessionBody.tsx` and the desktop arm to
`DesktopSessionBody.tsx`, leaving `SessionPage` as the router between them.

## Testing

- `useMobileSessionView.test.ts` — defaults to `'chat'`; `showBoard`/`showChat`
  flip the view; a message arriving while `view === 'board'` sets `hasUnread`;
  `showChat()` clears it; a message arriving while `view === 'chat'` never
  sets it.
- `SessionPage.test.tsx` — with `matchMedia` mocked below 768px: the composer
  and the "Show board" peek are visible on load and the full board is not;
  tapping the peek shows the board and the "Show chat" button while the
  composer is gone; tapping "Show chat" returns. Plus a case asserting the
  ≥768px path still renders board and chat together.
- `MessageList.test.tsx` — a false→true `isVisible` transition scrolls to
  bottom when the list was previously at the bottom.
- `ChatPane.test.tsx` — updated for the removed `onScrollUp` prop and the new
  `isVisible` prop.
- `useSessionBoardState.test.ts` — updated for the removed dock fields; any
  case asserting that `show_position`/`annotate_board` expands a docked board
  goes away with the dock itself.
- `useBoardDock.test.ts` — deleted alongside the hook.
- **Live browser verification at 390×844 is required before this is called
  done.** Passing unit tests are not evidence that a layout works; the failure
  being fixed here is precisely one that unit tests did not catch.

## Docs to update

- `docs/design.md` §3.1 — the `mobile` row's session-layout cell becomes the
  two-view switch, not "board docked top, chat below".
- `docs/design.md` §5.2 — replace scroll-driven docking with the peek-bar /
  board-view model.
- `docs/design.md` §5.6 — Explore is inline on the mobile board view, not
  behind a ⋯ menu.

## Out of scope

- Any change to desktop or tablet layout.
- Route-based views (`/session/:id/board`) and browser-back integration.
- Swipe gestures between views.
- The tab-bar hide-on-scroll behavior described in design.md §3.2.
