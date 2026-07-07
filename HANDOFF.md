# Pokémon Guess Who — Handoff (Issue 5 complete: guessing / win-loss, verified against live DB)

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
- **Issue 4** (turns / questions / answers + cross-off): **complete, applied to the live DB, and verified by
    the integration suite.**
  - Reducer: `ASK`, `ANSWER`, `CROSS_OFF` in `src/lib/game/reducer.ts`. `ASK` (current player, non-empty)
    flips `awaiting_question`→`awaiting_answer` keeping the turn with the asker; `ANSWER` (the *opponent* of the
    asker) passes the turn (answerer becomes `currentPlayer`) and returns to `awaiting_question`. `CROSS_OFF`
    toggles a card in `eliminated[player]` — **not turn-/phase-gated**, only ever touches the acting player's
    own list. Pure/deterministic as before.
  - Migration `00005_turns_questions_answers`: `match_events` (append-only Q/A thread, member-readable RLS,
    on Realtime) and `board_marks` (**owner-only RLS** — a mark never reaches the opponent's device or Realtime
    channel). RPCs `ask_question` / `answer_question` mirror the reducer and, in one txn, append the event **and**
    transition the `matches` row; `set_board_mark` toggles a private mark (un-gated). All writes are RPC-only
    (INSERT/UPDATE/DELETE revoked on both tables).
  - Client (`src/lib/matches.ts`): `askQuestion` / `answerQuestion` / `setBoardMark` (+ friendly error map),
    `useMatchEvents` (live thread, INSERT stream), `useBoardMarks` (live own-marks `Set`, INSERT+DELETE).
    Both hooks follow the **setAuth-before-subscribe** rule.
  - Match UI (`src/app/match/[id].tsx`) active-play: turn banner, live Q/A thread (auto-scrolls), turn-gated
    ask input, answer prompt with Yes/No quick buttons + free text, **tap a card to cross off / long-press for
    details**.
  - **Realtime hardening (verified on two devices):**
    - **Token-expiry refresh** — the Clerk session JWT lives only ~60s. Pinning one token onto a socket meant
      every RLS-gated `postgres_changes` silently died after ~1 min (a match's first question arrived, nothing
      after). New `useRealtimeAuth(supabase)` in `src/lib/supabase.ts` re-mints (`getToken({ skipCache: true })`)
      and re-applies the token every 40s, and returns `authNow` for the race-free initial join. All three
      subscription hooks (`useMatch`, `useMatchEvents`, `useBoardMarks`) use it. Proven against the live DB: a
      no-refresh client missed a question asked at t=80s; the 40s-refresh client received it.
    - **Optimistic cross-off** — `useBoardMarks` now returns `{ marks, toggle }`; `toggle` flips local state
      immediately, calls `set_board_mark`, and rolls back on error. A player's own cross-offs no longer depend on
      the realtime round-trip (which previously froze the board after one mark). Realtime stays as secondary sync.
  - **51/51 tests pass** (25 reducer + 26 integration, incl. new turn-loop & board-mark-privacy blocks against
    the live DB), `tsc` clean, `npm run lint` clean, security advisors clean (only the by-design
    "authenticated can execute SECURITY DEFINER" warnings). ⚠️ New integration tests leave `matches` /
    `match_events` / `board_marks` rows for the `rlstest1`/`rlstest2` profiles — clean up per the gotcha below.

- **Issue 5** (guessing / win-loss — first fully playable game): **complete, applied to the live DB, verified by
    the integration suite, and smoke-tested on device (guess flow confirms correct/incorrect).**
  - Reducer: `GUESS` in `src/lib/game/reducer.ts`. Gated exactly like `ASK` (current player, phase
    `awaiting_question` — you ask **XOR** guess). Correct → `status='completed'` + `winnerId` + `endedAt`.
    Wrong → auto-crosses the missed card on the **guesser's own** `eliminated` list and passes the turn
    (phase stays `awaiting_question`). Pure/deterministic; the guessed card only ever touches the guesser's
    private state.
  - Migration `00006_guessing_win_loss`: `guess` RPC (mirrors the reducer; reads the opponent's secret under
    SECURITY DEFINER to auto-validate). **Privacy by construction** — a guess is *never* written to the shared
    `match_events` thread, the RPC's composite return (`guess_result`) carries the opponent's secret **only on a
    correct/game-over guess**, and a wrong guess's auto-cross lands only in the guesser's owner-scoped
    `board_marks`. New `match_result` RPC reveals **both** secrets to **both** players, but only once
    `status='completed'` — the end-of-game reveal without ever loosening the column-level secret grants.
  - Client (`src/lib/matches.ts`): `guess()` (+ friendly error map, returns only `{correct, winnerId}` — never
    the opponent's secret on a wrong guess) and `useMatchResult(id, enabled)` for the reveal.
  - Match UI (`src/app/match/[id].tsx`): "Make a guess instead" enters a guess mode (banner turns green,
    tap-to-select a card, Confirm/Cancel bar) distinct from tap-to-cross-off; a wrong guess shows a toast and the
    turn passes; on completion a win/loss end screen reveals both secrets.
  - **63/63 tests pass** (32 reducer + 31 integration incl. new GUESS reducer + guess/match_result live-DB
    blocks: correct-win, wrong-guess auto-cross + turn-pass + privacy, not-your-turn, ask-XOR-guess), `tsc`
    clean, `npm run lint` clean, security advisors clean (only the by-design SECURITY DEFINER warnings). ⚠️ New
    integration tests leave `matches` / `board_marks` rows for the `rlstest1`/`rlstest2` profiles — clean up per
    the gotcha below.

## Next steps — Issue 6: stats on game end

`issues/06-stats-on-game-end.md`. A match now reaches `status='completed'` with `winner_id`/`ended_at` set, so
per-player stats (games played, wins/losses, win rate, streaks) can hang off that terminal transition.

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
- Integration tests hit the **live DB** using Clerk test users from `.env.local`; they leave `matches` rows.
  Clean up with an `execute_sql` deleting matches whose players are the `rlstest1`/`rlstest2` profiles (no
  client DELETE path). **Ask before deleting** — the user may be mid-testing with live rows.
- **`draw_secret` returns `void`** deliberately — returning the `matches` row would hand the 2nd drawer the
  opponent's secret. Clients learn their own secret via `my_secret`; the public row update arrives via Realtime.
- If **all MCP/connector calls fail with `net::ERR_FAILED`**: it's the desktop app's Chromium network service
  wedging (VPN-triggered), not the code — fully quit (`Cmd-Q`) and relaunch the app.
