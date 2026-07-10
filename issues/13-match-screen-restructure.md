# 13 — Match screen restructure: board owns the viewport

_Ready for agent. Source: UI/UX grilling session, 2026-07-10 (see [CONTEXT.md](../CONTEXT.md))._

## What to build

The centerpiece of the redesign. The board becomes the screen: all 24 tiles visible
at once, **never scrolling**, tuned for iPhone portrait down to SE size. The docked
thread panel (currently the bottom third) is removed; the thread moves behind a
floating **chat bubble** that opens a **chat modal** — a card over the dimmed board.

Flow rules (decided in grilling):

- **Chat bubble**: floating on the board; badges/pulses when the thread needs you
  (opponent asked/answered, it's your move to ask).
- **Chat modal**: card over dimmed board, tap-outside dismisses; a draft in the
  input survives dismiss/reopen (peek at the board, come back). Contains the full
  thread, ask input, Yes/No quick answers + answer input.
- **Auto-open only when you owe an answer** (on entering the screen or live when
  the question arrives). Your-turn-to-ask never auto-opens — the bubble pulses.
- **Turn strip** replaces the old turn banner: slim, always visible, shows the
  phase (lobby → blind draw → questioning → finished) and whose move it is.
  Resign and Review stay reachable from it.
- Guess mode stays on the board (tap card → confirm bar), as today.
- Phase orientation: each phase is visually distinct, and first-match hint copy
  ("Ask yes/no questions, flip cards to eliminate") orients new players.
- Review panel and card-detail panel adopt the shared modal component from 12.

Also write `docs/adr/0001-board-owns-the-viewport.md` — the docked-panel vs
bottom-sheet vs sibling-screen vs overlay trade-off and why the thread was demoted
to an overlay.

Presentation layer only: no reducer/RPC/DB changes. `summarizeTurn`, `useMatch`,
`useMatchEvents`, `useBoardMarks` are consumed as-is.

## Acceptance criteria

- [ ] All 24 tiles are visible without scrolling on an iPhone SE-sized viewport (and everything larger).
- [ ] The thread lives in the chat modal; the board screen has no docked thread panel.
- [ ] The chat modal auto-presents when (and only when) it becomes the player's move to answer.
- [ ] The chat bubble shows an attention state when the thread needs the player and is quiet otherwise.
- [ ] A composed-but-unsent draft survives dismissing and reopening the chat modal.
- [ ] The turn strip always shows current phase + whose move; resign/review remain reachable.
- [ ] Ask, answer (incl. Yes/No), guess, cross-off, review, resign, and claim flows all still work — existing jest suites stay green.
- [ ] ADR 0001 exists.
- [ ] `tsc`, lint, tests green.

## Blocked by

- 12 — Design system
