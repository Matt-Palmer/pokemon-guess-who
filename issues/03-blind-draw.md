# 03 — Blind draw

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

The secret-assignment phase before a game begins. At match start the 24 cards are
presented face-down. Player 1 blindly selects a card, which becomes their secret
(revealed only to them) and is removed from the pool so it can't be drawn again;
player 2 then blindly selects from the remaining 23. Once both secrets are
assigned, all 24 cards flip face-up and the game proper begins.

Secret assignment flows through the reducer's `DRAW_SECRET` event and is
persisted authoritatively (`player1_secret` / `player2_secret`), so each secret is
private to its owner and guaranteed distinct.

## Acceptance criteria

- [ ] At match start, cards render face-down and the draw is turn-ordered (P1 then P2).
- [ ] A player's drawn card is revealed only to them; the opponent never sees it.
- [ ] The two secrets are always distinct (P1's card is removed before P2 draws).
- [ ] After both draws, all 24 cards flip face-up for both players and the match transitions to active play.
- [ ] Secrets are stored authoritatively and protected by RLS (a player cannot read the opponent's secret).
- [ ] Tests: reducer coverage that `DRAW_SECRET` assigns distinct secrets, removes the drawn card from the pool, and transitions to face-up active state.

## Blocked by

- 02 — Party → shared realtime board
