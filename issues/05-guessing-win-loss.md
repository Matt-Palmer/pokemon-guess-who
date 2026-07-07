# 05 — Guessing & win/loss

_Ready for agent. First fully playable game. Source: [PRD.md](../PRD.md)._

## What to build

The mechanic that ends a game. On your turn you may instead guess by selecting
one of your remaining face-up cards and sending it. The server auto-validates the
guess against the opponent's stored secret and shows a reveal:

- **Correct** → you win, the match ends, both are shown the outcome.
- **Wrong** → the missed card is auto-crossed on your own board, the turn passes
  to your opponent, and the game continues. What you guessed (and that you
  guessed at all) stays fully private to you.

On a turn you may ask a question XOR guess — never both. Guesses flow through the
reducer's `GUESS` event.

## Acceptance criteria

- [ ] On your turn you can select a remaining face-up card and submit it as a guess (instead of asking).
- [ ] The server auto-validates against the opponent's secret; the result shows as a reveal.
- [ ] A correct guess ends the match with the guesser as winner and sets `winner_id` / `status = completed`.
- [ ] A wrong guess auto-crosses the missed card on the guesser's own board and passes the turn.
- [ ] The opponent is never shown what was guessed or that a guess occurred.
- [ ] A player cannot both ask and guess in the same turn.
- [ ] A full game can be played start-to-finish across two devices via a party code.
- [ ] Tests: reducer coverage of `GUESS` for correct (win/end) and wrong (auto-cross + pass turn + privacy) paths.

## Blocked by

- 04 — Turns, questions & answers + cross-off
