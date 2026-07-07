# 08 — Async & multiple games

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

The async, multi-game experience. The home screen becomes a list of all the
player's active games, each row showing the opponent and whose turn it is, with
games waiting on the player highlighted. Tapping a game resumes it exactly where
it was left (state rehydrated from Postgres). A cosmetic "online now" presence
indicator (via Supabase Presence) shows when an opponent is currently active —
purely informational, never triggering a forfeit. A player can hold many
concurrent games.

## Acceptance criteria

- [ ] The home screen lists all of the player's active games with opponent and whose-turn shown.
- [ ] Games where it's the player's move are visually highlighted.
- [ ] Tapping a game resumes it in its exact prior state; closing and reopening the app loses no progress.
- [ ] A player can have multiple games active simultaneously, each independent.
- [ ] A cosmetic presence indicator shows opponent online status and has no effect on game outcome.
- [ ] Tests: active-games list reflects match/turn state; resume rehydrates full match state.

## Blocked by

- 05 — Guessing & win/loss
