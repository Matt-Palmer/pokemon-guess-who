# 07 — Wrong-guess review panel

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

Support for recovering after a wrong guess. An in-game panel overlays the board
and shows two things: all the cards the player has crossed off so far, and the
full history of questions they've asked with their answers. It's available during
play (a slide-up/toggle over the board, not a separate route) so the player can
consult it while deciding their next guess.

## Acceptance criteria

- [ ] A review panel can be opened over the game screen without leaving the match.
- [ ] The panel lists the player's crossed-off cards for this match.
- [ ] The panel shows the full question/answer history (from `match_events`) for this match.
- [ ] The panel is readily reachable after a wrong guess.
- [ ] The panel shows only the viewing player's own private data (no opponent leakage).
- [ ] Tests: the review data (crossed-off set + Q&A history) is derived correctly from match state/events.

## Blocked by

- 05 — Guessing & win/loss
