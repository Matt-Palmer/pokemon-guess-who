# Pokémon Guess Who — Handoff (Issue 6 complete: stats on game-end, verified against live DB)

**Project:** `/Users/Matt/Dev/pokemon-guess-who` — Expo/expo-router + Clerk auth + Supabase (Postgres + Realtime).
Supabase project ref `azaemyxdzapolhqmcwpq`. Issues live in `issues/`, spec in `PRD.md`.

## What's done

- **Issue 1** (foundations): Clerk↔Supabase auth, `profiles` + `pokemon` (1025 seeded) tables, RLS keyed off
  `auth.jwt() ->> 'sub'`, typed reducer skeleton.
- **Issue 2** (party → shared realtime board): party create/join/start RPCs, lobby + shared 24-card board,
  `useMatch` realtime hook.
- **Issue 3** (blind draw): turn-ordered draw with `draw_secret`/`my_secret` RPCs, column-level SELECT revoked on
  the secret columns, blind-draw UI. Realtime secret privacy verified on the wire (two authenticated clients).
- **Issue 4** (turns / questions / answers + cross-off): `ASK`/`ANSWER`/`CROSS_OFF` in the reducer;
  `match_events` (shared Q/A thread) + `board_marks` (owner-only RLS) with RPC-only writes; live thread +
  turn-gated ask/answer UI; optimistic cross-off. Realtime hardening: `useRealtimeAuth` (setAuth-before-subscribe
  + 40s token refresh — the Clerk JWT lives ~60s).
- **Issue 5** (guessing / win-loss): `GUESS` in the reducer (ask XOR guess); `guess` RPC auto-validates against
  the opponent's secret under SECURITY DEFINER — correct → `status='completed'`+`winner_id`+`ended_at`, wrong →
  private auto-cross + turn passes; `match_result` RPC reveals both secrets only once completed. Guess-mode UI +
  win/loss end screen. Smoke-tested on device.
- **Issue 6** (stats on game-end): **complete, applied to the live DB, and verified by the integration suite.**
  - **Pure stats module** `src/lib/game/stats.ts`: `applyGameEnd(stats, 'win'|'loss')` (games/wins/losses,
    current streak increments on win / resets on loss, best streak tracks the max) + `winRatePercent` (derived,
    never stored). This is the single source of truth the DB trigger mirrors. 9 unit tests in `stats.test.ts`.
  - **Migration `00007_stats_on_game_end`:**
    - `apply_game_end_stats()` trigger on `matches` — fires once on the status *edge* into `'completed'`
      (`old.status is distinct from 'completed' and new.status = 'completed'`), updates **both** players'
      `profiles` counters in the same transaction as the game-ending write. Skips completions without a
      `winner_id` (future abandoned path). Any future game-ending RPC (resign, inactivity claim — Issue 10) gets
      stats for free by flipping the status.
    - **Counters are tamper-proof**: table-level INSERT/UPDATE/DELETE on `profiles` revoked; column-level
      INSERT/UPDATE re-granted on identity columns only (`clerk_id`, `username`, `avatar`, `expo_push_token`).
      A client `update({ wins: … })` fails with permission denied (integration-tested). Note the `clerk_id`
      UPDATE grant is required for supabase-js `upsert()` and is harmless — the RLS `with check` pins it to the
      caller's own sub.
    - `recompute_my_stats()` RPC — rebuilds the caller's counters from completed `matches` history (ordered
      replay of the same rule), proving the "recomputable from history of record" criterion and giving a repair
      path.
  - **Client:** `useProfile` now returns `refetch`; the Profile tab re-reads on focus (`useFocusEffect`) so stats
    reflect games completed this session. Win rate on the Profile screen now derives via the shared
    `winRatePercent`. (The five core stats were already rendered by `src/app/(tabs)/profile.tsx`.)
  - **76/76 tests pass** (32 reducer + 9 stats + 35 integration, incl. new live-DB blocks: winner/loser atomic
    deltas + streak/best-streak, wrong guess leaves records untouched, stat columns not client-writable,
    recompute parity with readable history), `tsc` clean, `npm run lint` clean, security advisors clean (only the
    by-design "authenticated can execute SECURITY DEFINER" warnings — `recompute_my_stats` joins that list; the
    trigger function itself is not client-executable). ⚠️ Integration tests leave `matches` / `match_events` /
    `board_marks` rows *and now real stat increments* on the `rlstest1`/`rlstest2` profiles — see the gotcha
    below.

## Next steps — Issue 7: wrong-guess review panel

`issues/07-wrong-guess-review-panel.md`. An in-game slide-up/toggle panel over the board showing the player's
crossed-off cards and their full Q/A history. All the data is already client-side: `useBoardMarks` (own marks)
and `useMatchEvents` (thread) in `src/lib/matches.ts` — this issue is UI-only, no DB changes expected.

## Gotchas for the new session

- **Realtime subscriptions:** use `useRealtimeAuth(supabase)` — `await authNow()` before `.subscribe()` (race-free
  join) **and** it keeps the socket's token refreshed. Passing an explicit token to `setAuth` before subscribe is
  necessary but NOT sufficient: the JWT expires in ~60s, so without the refresh loop RLS-gated changes silently
  stop arriving mid-match. Also, don't make a user's *own* action depend on the realtime round-trip — update local
  state optimistically (see `useBoardMarks`) and treat realtime as secondary sync.
- **Run tests/tsc/lint with node on PATH:** `export PATH="/usr/local/Cellar/node/24.1.0/bin:$PATH"`
  (`cd` in Bash can reset cwd/PATH). Lint is `npm run lint` (`expo lint`) — plain `npx eslint` pulls the wrong
  version.
- **DB changes go through the Supabase MCP** (`apply_migration` / `execute_sql`, project_id
  `azaemyxdzapolhqmcwpq`) — no local supabase CLI or `psql`.
- Integration tests hit the **live DB** using Clerk test users from `.env.local`; they leave `matches` rows and
  (since Issue 6) bump the `rlstest1`/`rlstest2` profiles' stat counters via the trigger. Clean up matches with an
  `execute_sql` deleting matches whose players are the test profiles (no client DELETE path). **Ask before
  deleting** — the user may be mid-testing with live rows. ⚠️ Deleting `matches` history makes trigger-accumulated
  counters diverge from `recompute_my_stats` (which replays surviving history) — after a cleanup, either recompute
  or zero the test profiles' counters too. The recompute-parity integration test is self-consistent either way.
- **Profiles stat columns are not client-writable** (column-level grants, Issue 6). If a new feature needs to
  write a new profile column from the client, it must be added to the column-level INSERT/UPDATE grant lists —
  a plain `alter table add column` will be readable but not writable by `authenticated`.
- **`draw_secret` returns `void`** deliberately — returning the `matches` row would hand the 2nd drawer the
  opponent's secret. Clients learn their own secret via `my_secret`; the public row update arrives via Realtime.
- If **all MCP/connector calls fail with `net::ERR_FAILED`**: it's the desktop app's Chromium network service
  wedging (VPN-triggered), not the code — fully quit (`Cmd-Q`) and relaunch the app.
