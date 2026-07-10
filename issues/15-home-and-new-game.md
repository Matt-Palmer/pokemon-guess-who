# 15 — Home + starting a game

_Ready for agent. Source: UI/UX grilling session, 2026-07-10 (see [CONTEXT.md](../CONTEXT.md))._

## What to build

Fix "starting a game is fragmented" and "home list is hard to parse".

- **Game-starting folds into home.** The generic New Game button + separate
  new-game screen give way to clear labeled paths on the home screen:
  **"Play a friend"** (party create / join-by-code) and **"Random opponent"**
  (matchmaking). The party-code join input appears in a shared modal rather than
  a separate route; `/matchmaking` remains its own (restyled) searching screen.
- **Richer game cards.** Each active game renders as a tactile card: opponent
  avatar + name, phase, whose move (strong "Your move" treatment — color, badge,
  sort-to-top), online dot, and lobby games show the shareable party code.
- **Empty state** that invites a first game instead of a text line.
- Lobby and matchmaking screens restyle onto the 12 components while keeping
  their flows (share code, opponent-found confirmation, cancel).

Existing hooks (`useMyMatches`, `useOnlinePlayers`, `createParty`, `joinParty`,
`useMatchmaking`) are consumed as-is. Presentation layer only.

## Acceptance criteria

- [ ] Home offers "Play a friend" and "Random opponent" directly; no generic New Game dead-end screen.
- [ ] Game rows are cards with avatar, phase, your-move emphasis, online presence; your-move games sort first.
- [ ] Party create/join and random matchmaking flows still work end-to-end (existing integration suites stay green).
- [ ] Lobby + matchmaking screens use the shared components; party code share and matchmaking cancel still work.
- [ ] Home shows an inviting empty state for new players.
- [ ] `tsc`, lint, tests green.

## Blocked by

- 12 — Design system
