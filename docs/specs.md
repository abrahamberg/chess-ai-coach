# Chess AI Coach — Product invariants

**Version:** 1.0 · **Date:** 2026-07-28 · **Status:** Approved for implementation

> This doc holds only what isn't already obvious from the code: the
> product's non-negotiable intent, the explicit out-of-scope boundary, and
> success criteria. What the app *does* today — routes, UI flows, functional
> behavior — is more reliably read from the code itself (`apps/api/src/routes`,
> `apps/web/src/features`) than from a spec written before it existed. Read
> this when adding a feature or when scope is ambiguous, not for routine
> bug fixes.

## 1. Vision

A **personal chess coach**, not another analysis site. Lichess and chess.com already show
you engine bars and "best move" arrows. This product does what a human coach does:

- Walks through **your** games with you, conversationally, over a board.
- Asks **Socratic questions** ("Why did you play this? What did you calculate? What did
  you reject?") instead of dumping engine lines.
- **Remembers you across sessions** — your recurring mistakes, your improvements, your
  current focus areas — and uses that memory to make every session build on the last.
- Tracks growth over time and shows it.

The engine (Stockfish) runs behind the scenes and informs the coach; raw evals are
**not** the product surface. The coach decides what to reveal and when.

### 1.1 The differentiator (non-negotiable)

The coach is a **stateful agent that knows the user**. Every design decision must serve
this. If a feature could exist identically on lichess.org/analysis, it is not our core.

## 2. Target users

Chess.com rating **500–2000** (Lichess roughly 800–2200). These players know the rules
and basic techniques. Their bottlenecks are:

| Band | Chess.com rating | Typical bottlenecks |
|------|-----------------|---------------------|
| `novice` | 500–900 | Hanging pieces, one-move threats, no blunder-check habit |
| `improving` | 900–1300 | Missed tactics, no opening plan, poor piece coordination |
| `club` | 1300–1700 | Calculation depth/accuracy, pawn-structure understanding, endgame technique |
| `advanced` | 1700–2000 | Decision-making quality, evaluating unforced positions, narrow-repertoire depth, prophylaxis |

The coach calibrates vocabulary, question difficulty, and how much it reveals per band
(see `docs/prompts.md` §2.3). Users outside 500–2000 may use the product; the coach
clamps them to the nearest band.

## 3. Non-functional targets not visible from a single file

- Coach first-token latency < 3 s; board tool actions render < 500 ms after the
  tool call streams; analysis pipeline completes < 90 s for a 60-move game.
- Test coverage target ≥80% line coverage on `apps/api` and `packages/*`.

## 4. Out of scope (v1)

- Playing against the coach / sparring mode.
- Calculation-training mode with curated studies (v2 — prompt already drafted).
- Opening-repertoire builder (v2).
- Mobile apps (responsive web only).
- chess.com automatic game import (no public API for arbitrary fetch → user pastes).
- Multi-language coaching (English only).
- Voice input/output.

## 5. Success criteria

- S1 A user can go from pasted PGN to an interactive coached session in under 2 minutes.
- S2 After 3 sessions, the coach demonstrably references earlier sessions' findings
  (verifiable in conversation logs).
- S3 Findings and focus areas populate automatically — no manual tagging by the user.
- S4 A fresh cluster deploys end-to-end with `helm install` + a values file.
- S5 A BYOK user incurs zero credit spend; a credits user sees an accurate balance
  after every session.
