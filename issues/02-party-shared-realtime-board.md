# 02 — Party → shared realtime board

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

The core tracer bullet: getting two devices into one match and proving
authoritative shared state syncs live. A player can start a private party and
receive a 6-character alphanumeric code (excluding ambiguous 0/O, 1/I/L, unique
among active parties). The host waits in a lobby showing the code (with copy
button) and "waiting for opponent"; a second player joins by entering the code.
Joining an invalid/full/in-progress code shows a clear error. The host presses
Start.

On start, the server generates the shared board — 24 random `pokemon` rows,
generated server-side so both players see the identical board — and both players
land on a game screen rendering all 24 cards face-up, kept in sync via Postgres
Changes. Tapping a card expands its details (type, generation). A minimal home
screen exposes a "New Game" entry that opens the party create/join flow.

No blind draw, turns, or guessing yet — this slice is: two players, one
authoritative shared board, live.

## Acceptance criteria

- [ ] A host can create a party and receives a unique, unambiguous 6-char code with a copy button.
- [ ] The lobby shows "waiting for opponent" and then the joiner's username/avatar; the host has a Start button.
- [ ] A second device can join with the code; invalid/full/in-progress codes show a clear error.
- [ ] On Start, a `matches` row is created with a server-generated 24-card `board[]`; both clients render the identical face-up board.
- [ ] Board state syncs to both devices via Postgres Changes; a Realtime channel is authorized to only the two players.
- [ ] Tapping a card shows its type and generation from the seeded `pokemon` table.
- [ ] Codes are recycled after a game ends.
- [ ] Tests: RPC integration for party create/join (code uniqueness, full/in-progress rejection) and server-side board generation (identical shared board of 24).

## Blocked by

- 01 — Foundations & walking skeleton
