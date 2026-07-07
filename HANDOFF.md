# Pokémon Guess Who — Handoff (Issue 3 complete + verified on two devices)

**Project:** `/Users/Matt/Dev/pokemon-guess-who` — Expo/expo-router + Clerk auth + Supabase (Postgres + Realtime).
Supabase project ref `azaemyxdzapolhqmcwpq`. Issues live in `issues/`, spec in `PRD.md`.

## What's done

- **Issue 1** (foundations): Clerk↔Supabase auth, `profiles` + `pokemon` (1025 seeded) tables, RLS keyed off
  `auth.jwt() ->> 'sub'`, typed reducer skeleton.
- **Issue 2** (party → shared realtime board): party create/join/start RPCs, lobby + shared 24-card board,
  `useMatch` realtime hook.
- **Issue 3** (blind draw): **complete, applied to the live DB, and smoke-tested end-to-end on two real devices.**
  - Reducer: `DRAW_SECRET` in `src/lib/game/reducer.ts` (turn-ordered P1→P2, on-board, no-redraw,
    distinctness). Pure/deterministic — randomness (board gen, first-turn coin flip) stays in the DB adapter.
  - Migration `00004_blind_draw`: `player1_drawn`/`player2_drawn` **generated** boolean flags; **column-level
    SELECT revoked** on `player1_secret`/`player2_secret`; `draw_secret` RPC (rules + coin-flips the first turn
    on the 2nd draw → `phase='awaiting_question'`, `current_player`); `my_secret` RPC (caller's own secret only).
  - Client: `drawSecret()` + `useMySecret()` in `src/lib/matches.ts`; `MatchRow` drops the secret columns and
    gains the `_drawn` flags; `useMatch` selects an explicit column list (wildcard `*` is rejected for a
    column-restricted role). Blind-draw UI in `src/app/match/[id].tsx` (face-down board, turn-ordered
    tap-to-draw, private reveal, flips face-up once both drawn).
  - **Realtime secret privacy is verified** (two authenticated clients): a broadcast `matches` change carries
    only the 16 granted columns — `player{1,2}_secret` are never on the wire. Data-API privacy is also covered
    by an integration test.
  - **Bug fixed along the way — Realtime auth race (was silently breaking the lobby):** `useMatch` now
    `await supabase.realtime.setAuth()` **before** `.subscribe()`. supabase-js applies Realtime auth
    asynchronously at client construction, so in RN (slow Clerk `getToken()`) the channel could join as `anon`
    before the JWT landed and then receive **no** RLS-gated `postgres_changes` — e.g. the host never saw the
    opponent join, so Start never enabled. Any *new* realtime subscription must follow the same
    setAuth-before-subscribe pattern.
  - **34/34 tests pass**, `tsc` clean, `npm run lint` clean, security advisors clean (only the by-design
    "authenticated can execute SECURITY DEFINER" warnings).

## Next steps — Issue 4: turns / questions / answers

`issues/04-turns-questions-answers.md`. Blind draw already sets `current_player` / `phase` (and the
`first_player` coin flip) on the 2nd draw, so play can start from there.

1. Build `ASK` and `ANSWER` in the reducer **test-first** (`src/lib/game/reducer.ts`) — strict alternating
   turns, `phase` transitions (`awaiting_question` → `awaiting_answer` → back with turn passing to the answerer).
   Crossing-off is NOT turn-gated (that's a later issue / private action).
2. Add the DB adapter RPCs (mirror the reducer rules; the coin flip already happened in `draw_secret`).
3. Wire the match UI: turn indicator, ask-a-question input (turn-gated), answer prompt for the opponent.

## Gotchas for the new session

- **Realtime subscriptions:** always `await supabase.realtime.setAuth()` before `.subscribe()` (see the bug
  fix above) or RLS-gated changes silently won't arrive in the app.
- **Run tests/tsc/lint with node on PATH:** `export PATH="/usr/local/Cellar/node/24.1.0/bin:$PATH"`
  (`cd` in Bash can reset cwd/PATH). Lint is `npm run lint` (`expo lint`) — plain `npx eslint` pulls the wrong
  version.
- **DB changes go through the Supabase MCP** (`apply_migration` / `execute_sql`, project_id
  `azaemyxdzapolhqmcwpq`) — no local supabase CLI or `psql`.
- Integration tests hit the **live DB** using Clerk test users from `.env.local`; they leave `matches` rows.
  Clean up with an `execute_sql` deleting matches whose players are the `rlstest1`/`rlstest2` profiles (no
  client DELETE path). **Ask before deleting** — the user may be mid-testing with live rows.
- **`draw_secret` returns `void`** deliberately — returning the `matches` row would hand the 2nd drawer the
  opponent's secret. Clients learn their own secret via `my_secret`; the public row update arrives via Realtime.
- If **all MCP/connector calls fail with `net::ERR_FAILED`**: it's the desktop app's Chromium network service
  wedging (VPN-triggered), not the code — fully quit (`Cmd-Q`) and relaunch the app.
