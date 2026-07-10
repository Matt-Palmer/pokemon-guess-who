# 16 — Auth screens + profile as a player card

_Ready for agent. Source: UI/UX grilling session, 2026-07-10 (see [CONTEXT.md](../CONTEXT.md))._

## What to build

Fix "auth/profile feel bolted on" — the first impression and the identity screen.

- **Sign-in / sign-up** get the board-game theme: logo/wordmark treatment, warm
  background, shared `Button`/`TextField`, friendly error states. The Clerk flows
  (email+password, verification) are unchanged underneath.
- **Profile becomes a player card**: avatar + username presented like a game
  piece; the six stats (played / wins / losses / win rate / streak / best streak)
  rendered as achievement-style tiles rather than a plain grid; sign-out demoted
  to a quiet action.

Presentation layer only — Clerk logic, `useProfile`, and stats derivation are
consumed as-is.

## Acceptance criteria

- [ ] Sign-in and sign-up are built from shared components and match the theme; auth flows still work.
- [ ] Profile renders as a player card with achievement-style stat tiles (values still from `useProfile` + `winRatePercent`).
- [ ] Error/loading states on all three screens are themed, not default spinners on white.
- [ ] `tsc`, lint, tests green.

## Blocked by

- 12 — Design system
