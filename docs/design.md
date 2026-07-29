# Chess AI Coach — UI/UX Design

**Version:** 1.0 · **Date:** 2026-07-28 · Companion to `specs.md`. Phase 6 of
`plan.md` implements this document; deviations require updating this doc first.

---

## 1. Design principles

1. **A quiet study room, not a dashboard.** The user is here to think. Minimal
   chrome, generous whitespace, no gamification noise (streaks, achievement
   badges, notification dots), nothing blinking for attention. Move-quality
   badges (§5.5) are a narrow, deliberate exception — they're analysis of
   the move itself, not app-level gamification. The two protagonists on
   screen are the **board** and the **conversation** — everything else
   recedes.
2. **Conversation-first.** This is a coaching session, not an analysis viewer.
   The chat is never squeezed into a sidebar afterthought; on every screen size
   the current coach message is readable without scrolling gymnastics.
3. **The board is a shared object, not an illustration.** Coach and student both
   act on it (coach via tools, student via drag/tap). It must always reflect the
   current point of conversation, and changes to it must be noticeable (animation)
   but never disorienting (no teleporting mid-read).
4. **Engine invisible.** No eval bars, no centipawn numbers, no engine lines in
   the primary UI. The one exception: the opt-in Explore panel (§5.6), clearly
   labeled as exploration. Move-quality badges (§5.5) are a deliberate,
   narrower exception too — they show a qualitative tier (a colored icon:
   best/miss/blunder/etc.), never a raw number.
5. **Mobile is a first-class citizen.** Every flow works one-handed on a 360 px
   phone. Desktop is not "mobile stretched": it uses the space for side-by-side
   composition.

## 2. Visual language

### 2.1 Color tokens (CSS custom properties, light + dark)

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--bg` | `#faf9f7` | `#15140f` | app background (warm off-white / warm near-black) |
| `--surface` | `#ffffff` | `#1e1c16` | cards, chat pane |
| `--surface-2` | `#f1efe9` | `#282520` | bubbles (coach), inputs |
| `--text` | `#26241e` | `#e8e5dd` | primary text |
| `--text-muted` | `#6f6a5e` | `#9a948a` | secondary text, timestamps |
| `--accent` | `#3d6b48` | `#7fb08a` | primary actions, links, user bubble tint (deep board-green) |
| `--accent-contrast` | `#ffffff` | `#15140f` | text on accent |
| `--warn` | `#a05a2c` | `#d99a63` | destructive/credit warnings |
| `--board-light` | `#ede2c8` | `#bfb294` | light squares |
| `--board-dark` | `#8ba173` | `#6e8258` | dark squares |
| `--annotate-1` | `#c9762a` | same | coach arrows/highlights (warm orange, distinct from both square colors) |
| `--annotate-2` | `#4a7fb5` | same | secondary annotation color |

Theme follows `prefers-color-scheme` with a manual toggle in Settings. All
text/background pairs must meet WCAG AA (4.5:1); `--text-muted` on `--surface`
included.

### 2.2 Typography

- UI + chat: system stack (`-apple-system, "Segoe UI", Roboto, sans-serif`).
  Chat body 16 px / 1.6 line-height (never smaller — it's the primary content).
- Moves and FEN-ish content: tabular figures, `font-feature-settings: "tnum"`;
  SAN inside chat text renders in a subtle `--surface-2` chip
  (`<code class="san">Nf3</code>`) so moves are scannable inside prose.
- Scale: 24/20/16/14 px (page title / section / body / meta). Nothing smaller
  than 14 px anywhere.

### 2.3 Spacing, shape, elevation

- 4 px base grid; component padding 12–16 px; page gutters 16 px mobile,
  24 px desktop.
- Radius: 12 px cards/bubbles, 8 px buttons/inputs, board squares square.
- Elevation: borders (`1px solid` at 8% fg) over shadows; max one shadow level
  (bottom bars/modals).

## 3. Layout system & navigation

### 3.1 Breakpoints

| Name | Width | Session layout | Navigation |
|------|-------|----------------|-----------|
| `mobile` | < 768 px | stacked: board docked top, chat below (§5.2) | bottom tab bar |
| `tablet` | 768–1079 px | side-by-side, board 55% | bottom tab bar |
| `desktop` | ≥ 1080 px | side-by-side, board max 640 px + chat column (§5.1) | slim left rail |

### 3.2 Navigation structure (4 destinations)

```
Games (home)  ·  Progress  ·  Settings  ·  [contextual: active Session]
```

- **Mobile/tablet:** bottom tab bar, 56 px tall, safe-area aware. When a session
  is active, a 4th tab "Session" appears with a subtle dot while the coach has
  streamed a new message you haven't seen.
- **Desktop:** 64 px icon rail on the left (logo top; Games/Progress/Settings;
  avatar + credit balance bottom). No expanded sidebar — labels on hover
  tooltip. The content area is centered, max-width 1280 px except the session
  screen which uses full width.
- The session screen itself is immersive: on mobile the tab bar hides on scroll
  down, returns on scroll up.

## 4. Screens (non-session)

### 4.1 Games (home)

- Primary CTA card at top: **"Analyze a game"** → Import.
- Below: game list (most recent first). Each row: players + result (user's side
  bold, colored dot for W/L/D), date, time control, and a status chip:
  `analyzing…` (animated) / `ready — start session` / `session done ✓` /
  `failed — retry`. Row tap → session (or status detail).
- Empty state (first visit): friendly one-liner + the import CTA + "or connect
  your Lichess account" link. No dummy data.

### 4.2 Import

- Segmented control: **Paste** | **Upload** | **From Lichess** (third hidden if
  no linked account, replaced by a "link account" hint).
- Paste: full-width monospace textarea, auto-validates on paste (checkmark or
  specific error inline), "Analyze" button pinned below.
- From Lichess: list of last 20 games (same row format as 4.1), tap to select.
- Color-confirm step only when detection fails (F1.3): two large side-by-side
  buttons "I played White / I played Black" showing the player names.
- After submit → **Analysis progress screen**: the board shows the game's final
  position dimmed, over it a three-step progress ("Reading game → Engine review →
  Coach preparing your session") driven by the SSE status; auto-navigates into
  the session on `ready`. This wait (30–90 s) must feel attended: rotate short
  tips ("The coach reviews every move, but you'll only talk about what matters").

### 4.3 Progress (dashboard)

Order, mobile-first single column (desktop: 2-column grid, focus areas left):

1. **Focus areas** — up to 3 cards: category name in plain words ("Calculation
   depth"), coach's note, trend arrow (↗ improving / → steady / ↘ needs work),
   evidence count, last-seen. Resolved areas collapse into a "Resolved ✓"
   history accordion.
2. **Mistake trends** — one bar-per-category chart for the last 20 games,
   toggle "last 5 / last 20"; tapping a bar lists the contributing findings.
3. **Session history** — list: game, date, one-line `sessionSummary`, homework
   chip if assigned. Tap → reopen session read-only (board + transcript).

### 4.4 Settings

Sections: Profile (name, rating band selector with the 4 bands described in
plain language, linked usernames) · API keys (per provider: "saved ✓ · delete"
or "add key" — key never redisplayed) · Credits (balance, 3 pack cards → Stripe
Checkout) · Appearance (theme) · Account.

## 5. The session screen (the product)

### 5.1 Desktop (≥1080 px)

```
┌──┬───────────────────────────────┬──────────────────────────────┐
│  │  ○ Marta vs. daniel  0-1      │  Coach                    ⋯  │
│r │ ┌───────────────────────────┐ │ ┌──────────────────────────┐ │
│a │ │                           │ │ │ Before this knight move, │ │
│i │ │                           │ │ │ what did you want your   │ │
│l │ │         BOARD             │ │ │ pieces to achieve?       │ │
│  │ │       (≤640 px)           │ │ └──────────────────────────┘ │
│  │ │                           │ │        ┌───────────────────┐ │
│  │ │                           │ │        │ I wanted to attack│ │
│  │ └───────────────────────────┘ │        │ the king…         │ │
│  │  ◀ ◀◀   move 14 of 38  ▶▶ ▶   │        └───────────────────┘ │
│  │  [♘f3 chip-strip of moves]    │  👀 checking a line…         │
│  │  ▸ Explore on your own        │ ┌──────────────────────────┐ │
│  │                               │ │ type a reply…      [Send]│ │
└──┴───────────────────────────────┴──────────────────────────────┘
```

- Board column: fixed, vertically centered; under it the **move strip**
  (horizontal, auto-scrolls to current ply, tap any move to peek — peeking is
  local-only and snaps back when the coach next calls `show_position`).
- Chat column: 380–480 px, independently scrollable, input pinned bottom.

### 5.2 Mobile (<768 px) — the key layout

**Board docked top, chat scrolls beneath.** Rejected alternatives: tabs
(board/chat) break the "shared object" principle — you can't read a question
and see the position; chat-overlay-on-board hides the position mid-thought.

```
┌────────────────────────────┐
│ ◀  Marta vs. daniel   ⋯    │  40px header (back, menu)
├────────────────────────────┤
│                            │
│          BOARD             │  width: 100vw, height = width
│                            │  (docked / position: sticky top)
├────────────────────────────┤
│ ◀ ◀◀  move 14/38  ▶▶ ▶     │  36px move bar (also swipe on board)
├────────────────────────────┤
│ chat scrolls here…         │
│ ┌────────────────────────┐ │
│ │ Coach: what did you    │ │
│ │ want your pieces to…   │ │
│ └────────────────────────┘ │
│         ┌────────────────┐ │
│         │ I wanted to…   │ │
│         └────────────────┘ │
├────────────────────────────┤
│ [type a reply…      Send ] │  input pinned above keyboard
└────────────────────────────┘
```

- On 360×640 the board (360 px) + header + move bar leave ~200 px of chat —
  tight but readable (~3 lines + input). Therefore: **when the user scrolls the
  chat up, the board collapses smoothly to a 96 px mini-board** (docked
  top-right, current position thumbnail); tapping it or any SAN chip in chat
  expands it back. When the coach calls `show_position`/`annotate_board`, the
  board auto-expands.
- Landscape phones get the tablet side-by-side layout.
- Keyboard-open state: board auto-collapses to mini so the last coach message
  stays visible above the input.

### 5.3 Conversation rendering

- Coach messages: `--surface-2` bubbles, left-aligned, no avatar spam (one
  small ♞ avatar at the start of each coach run). Streaming: text renders as it
  arrives with a 1-char fade; **auto-scroll only if the user is already at the
  bottom** (never yank them while reading history).
- User messages: right-aligned, `--accent` at 12% tint.
- **Board moves as messages:** when the user answers by moving on the board, it
  appears in chat as a compact move card: `You played ♘xd5` with a 64 px
  position thumbnail. Same for coach `show_position` jumps: a thin centered
  divider line — `— move 14, after ♗g4 —` — so the transcript reads like an
  annotated game later.
- Tool activity (`get_engine_analysis` etc.): one subtle italic line with a
  small spinner — `👀 checking a line…` — replaced by nothing when done (the
  result surfaces only through the coach's words). `update_threads` and
  profile/finding tool frames render **nothing at all** (backstage, per
  architecture §7.5).
- Session start: system-style card with game header + the coach's opener.
- Session end: summary card (coach summary + homework in a checkbox-style chip)
  with "Back to Games" / "View Progress" actions.

### 5.4 Board interaction

- Piece move: drag on desktop, tap-tap on mobile (both always available). Legal
  destinations dotted on piece pickup; illegal drop snaps back with a 150 ms
  shake, no error text.
- **Answer mode vs. peek mode.** Default is answer mode: a completed user move
  is sent as `[board_move]` (a 2 s undo pill appears — "Sending ♘xd5… ↩︎ undo" —
  to forgive slips). Peek mode (entered via move strip or Explore) tints the
  board frame `--annotate-2` and shows a persistent "exploring — ⟲ back to
  coach" pill; moves in peek mode are never sent.
- Coach `show_position`: pieces animate (200 ms) along the move path when the
  jump is ±1 ply; longer jumps cross-fade (no piece spaghetti). Coach arrows
  draw with a 150 ms sweep; cleared on next `show_position`.
- Auto-flip: board oriented to the user's color, always.

### 5.5 Move strip / move explorer

Horizontal chip list on mobile (`1. e4 e5 2. ♘f3 …`) / paired move list on
desktop; current ply filled `--accent`; moves at coaching-plan moments get a
small dot under them. Every move also carries a quality badge — a small
colored circle + glyph (★ best, !! brilliant, !? interesting, ?! dubious,
? mistake, ✕ miss, ?? blunder; plain "good" moves get no badge) — computed
from the game's engine analysis, matching between mobile and desktop (see
`docs/superpowers/specs/2026-07-29-move-quality-badges-design.md`). Keyboard
←/→ on desktop; swipe left/right on the board on mobile.

### 5.6 Explore panel (WASM engine)

Collapsed by default under the board (desktop) / behind the ⋯ menu (mobile):
"Explore on your own". Expands to: eval in words + best-move arrow from the
in-browser engine, clearly captioned "your private exploration — the coach
isn't watching". Opening it enters peek mode. Together with the move-quality
badges (§5.5), this is the only other place engine output surfaces — and
neither ever shows raw numbers: the Explore panel speaks in words only
("White is clearly better"), and the badges show a qualitative tier
(colored icon), never a centipawn value.

### 5.7 Session states

- **paused_no_credits:** chat input replaced by a card: "The session is saved.
  Add credits or your own API key to continue." + both CTAs. Transcript stays
  readable.
- **Reconnecting** (SSE drop): thin amber line under header "reconnecting…";
  input disabled until re-established; on resume, missed messages replay.
- **Coach thinking** (first token pending): typing indicator (3 dots) in a
  coach bubble, appears after 300 ms delay to avoid flicker.

## 6. Component inventory (maps to plan.md Phase 6)

| Component | Props (shape) | Notes |
|-----------|--------------|-------|
| `AppShell` | `{nav, children}` | rail/tab bar switch at 768/1080 px |
| `CoachBoard` | `{fen, orientation, arrows, highlights, mode:'answer'\|'peek', onUserMove}` | presentational; react-chessboard |
| `MiniBoard` | `{fen, size}` | thumbnails (chat cards, collapsed board) |
| `MoveStrip` | `{sanMoves, currentPly, momentPlies, onSelect}` | |
| `ChatPane` | `{messages, streaming, onSend}` | virtualized ≥100 messages |
| `MoveCard` / `PositionDivider` | `{san, fen}` / `{ply, san}` | chat message variants |
| `ToolActivity` | `{label}` | italic spinner line |
| `SessionSummaryCard` | `{summary, homework}` | |
| `GameRow` | `{game, status}` | list item, 64 px, whole row tappable |
| `AnalysisProgress` | `{status}` | 3-step indicator + tips |
| `FocusAreaCard` | `{area, trend}` | |
| `TrendChart` | `{byCategory, range}` | bars, `--accent` scale |
| `PackCard` / `ByokKeyForm` / `BandSelect` | | settings |

All are presentational (props in, events out) per AGENTS.md rule 7; hooks own
data.

## 7. Accessibility & input

- Touch targets ≥ 44×44 px (move strip chips get invisible padding).
- Full keyboard path on desktop: tab order board → move strip → chat; arrows
  navigate plies; board squares focusable with arrow keys + Enter (standard
  react-chessboard a11y), announced as "e4, white pawn".
- Coach messages stream into an `aria-live="polite"` region; board jumps
  announce "Position: move 14, after bishop g4".
- `prefers-reduced-motion`: all board animation → instant, spinners → static.
- Color is never the only signal (W/L dot + letters; trend arrow + word).

## 8. Copy voice

UI copy is calm and small: sentence case, no exclamation marks, no "Oops!".
The coach has personality; the UI does not compete with it. Errors say what
happened and the next action ("That PGN has an illegal move at 24. Check the
paste and try again.").
