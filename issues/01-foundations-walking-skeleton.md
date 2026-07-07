# 01 — Foundations & walking skeleton

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

The end-to-end skeleton the whole app hangs off: an Expo (expo-router) project
with Clerk authentication, a Supabase client wired to Clerk via the `accessToken`
callback so every request carries the Clerk session JWT, and RLS policies keyed
off the Clerk `sub` claim. A `profiles` table holds one row per user. A one-time
seed populates the `pokemon` reference table with all 1025 Pokémon
(`id`, `name`, `sprite_url`, `types[]`, `generation`) from the PokéAPI.

Signing in on a device creates/loads that user's profile and lands them on a
minimal authenticated screen. This slice proves auth → database → UI works with
Clerk-backed RLS before any game logic exists.

## Acceptance criteria

- [ ] A user can sign up and sign in via Clerk; unauthenticated users are gated out.
- [ ] The Supabase client attaches the Clerk token; RLS reads `auth.jwt() ->> 'sub'`.
- [ ] A signed-in user has exactly one `profiles` row (username, avatar, push-token column present, stat counters initialized).
- [ ] A user can only read/write their own profile row (RLS enforced, verified on two accounts).
- [ ] The `pokemon` table is seeded with all 1025 rows including sprite URL, types, and generation.
- [ ] Tests: RPC/integration coverage that RLS blocks cross-user profile access; the reducer module exists as a typed skeleton (no game events yet).

## Blocked by

None - can start immediately.
