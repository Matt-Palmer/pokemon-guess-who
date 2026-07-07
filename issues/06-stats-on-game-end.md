# 06 — Stats on game-end

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

Personal records. When a match ends, both players' denormalized stat counters on
their `profiles` row are updated: games played, wins, losses, current streak, and
best streak. Win rate is derived. The update is authoritative (trigger or Edge
Function on game-end), backed by the `matches` history so stats can be recomputed
or extended later. The Profile screen displays the five core stats.

## Acceptance criteria

- [ ] On game-end, the winner's and loser's counters update atomically (games played, wins/losses, streaks).
- [ ] Current streak increments on a win and resets on a loss; best streak tracks the max.
- [ ] Win rate is derived from wins ÷ games played and shown on the Profile screen.
- [ ] The five core stats render on the Profile screen and reflect completed games.
- [ ] Counters are backed by an authoritative `matches` history (recomputable).
- [ ] Tests: reducer coverage of stat/streak deltas on win and loss game-end events.

## Blocked by

- 05 — Guessing & win/loss
