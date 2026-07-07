# 10 — Resign & 7-day inactivity claim

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

Graceful exits for dead or unwanted games. A player can resign a game, which is an
immediate forfeit: the opponent wins and the resigner takes a loss (stats update
accordingly). A disconnect or app-close does NOT forfeit — the game stays intact
and resumable. If it's a player's turn and they haven't moved for 7 days, the
opponent may claim the game as a win (counting as the no-show's loss). A visible
countdown communicates when a claim becomes available. Resign and claim flow
through the reducer's `RESIGN` and `CLAIM_INACTIVE` events.

## Acceptance criteria

- [ ] A player can resign; the opponent immediately wins and the resigner records a loss.
- [ ] A disconnect / app-close never forfeits; the game remains intact and resumable.
- [ ] When an opponent hasn't moved for 7 days, the waiting player sees a claim option.
- [ ] A countdown shows how long until the claim becomes available.
- [ ] Claiming an inactive game counts as a win for the claimer and a loss for the no-show, updating stats.
- [ ] Tests: reducer coverage of `RESIGN` (forfeit/loss + opponent win) and `CLAIM_INACTIVE` (eligibility after 7 days + win/loss outcome).

## Blocked by

- 06 — Stats on game-end
