# 04 — Turns, questions & answers + cross-off

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

The turn loop. A random coin flip picks who goes first. The match tracks
`current_player` and `phase` (`awaiting_question` | `awaiting_answer`). On your
turn you type a free-text question; it posts to a chat thread (`match_events`),
`phase` becomes `awaiting_answer`, and your opponent is prompted to answer. When
they answer, the answer appears in the thread and the turn passes to them.

Separately and at any time (not turn-gated), a player can cross off / hide cards
on their own board; these marks are private (`board_marks`) and give the opponent
no information. Questions and answers flow through the reducer's `ASK` and
`ANSWER` events; cross-off through `CROSS_OFF`.

## Acceptance criteria

- [ ] First turn is decided by a random coin flip at game start.
- [ ] A clear turn banner shows whose turn it is / what action is required.
- [ ] On your turn you can post exactly one free-text question; the opponent is prompted to answer before the turn passes.
- [ ] The full running question/answer thread is visible to both players and persisted in `match_events`.
- [ ] After the opponent answers, the turn passes and `phase` returns to `awaiting_question`.
- [ ] A player can cross off / un-cross their own cards at any time; marks are private (opponent's view is unaffected).
- [ ] Tests: reducer coverage of `ASK`→`ANSWER` phase transitions, turn passing, and that `CROSS_OFF` is un-gated and does not mutate the opponent's visible state.

## Blocked by

- 03 — Blind draw
