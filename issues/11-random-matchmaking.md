# 11 — Random matchmaking

_Ready for agent. Can be built in parallel with 03–05. Source: [PRD.md](../PRD.md)._

## What to build

The second entry path: pairing with a stranger. Tapping "Find a random game" adds
the player to a `matchmaking_queue` and an atomic Postgres RPC pairs them with the
longest-waiting opponent using row locking, so two players can never grab the same
opponent (the concurrency safety is the point). A "Searching for opponent…" screen
offers a Cancel button that removes the player from the queue. On a pairing, a
brief "Opponent found: [username]" confirmation shows before dropping both players
into the same game flow (board generation → blind draw → play).

## Acceptance criteria

- [ ] "Find a random game" enqueues the player and shows a "Searching…" screen with a working Cancel.
- [ ] The atomic pairing RPC matches the two longest-waiting players; no player is ever double-matched under concurrent requests.
- [ ] Cancelling removes the player from the queue.
- [ ] On pairing, a brief "Opponent found: [username]" confirmation precedes the game, which then follows the standard board/draw/play flow.
- [ ] Matched games are indistinguishable from party games once started.
- [ ] Tests: RPC integration under concurrency — two simultaneous enqueues pair exactly once and never share an opponent.

## Blocked by

- 02 — Party → shared realtime board
