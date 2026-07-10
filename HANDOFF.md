# Pokémon Guess Who — Handoff (Issue 12 complete: UI/UX redesign underway — issues 13–16 remain)

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

- **Issue 7** (wrong-guess review panel): UI-only, **no DB changes** — the data was already client-side
  (`useBoardMarks` own marks, `useMatchEvents` thread).
  - **Pure derivations** `src/lib/game/review.ts`: `pairThread` groups the ordered event thread into
    question→answer entries (answer attaches to the most recent unanswered question; orphan answers dropped) and
    `splitByMarks` splits the board into crossed-off/remaining in board order. 9 unit tests in `review.test.ts`
    cover the "review data derived correctly" criterion.
  - **UI** in `src/app/match/[id].tsx`: a slide-up review panel over the board (backdrop + close, same pattern as
    the card-detail panel) showing the player's crossed-off cards (mini grid) and the full Q/A history as paired
    entries, with a "N crossed off · M remaining" summary. Opened two ways: a persistent **Review** button in the
    turn banner (available in normal and guess mode), and a **"Review your clues"** link inside the wrong-guess
    feedback box — the "readily reachable after a wrong guess" criterion. Privacy is by construction: marks are
    RLS-scoped to the caller and the thread is the shared Q/A both players already see.
  - **85/85 tests pass**, `tsc` clean, `npm run lint` clean. Not yet smoke-tested on device (needs two players
    mid-match).
- **Issue 8** (async & multiple games): home screen is now the active-games list; applied to the live DB and
  verified by the integration suite.
  - **Pure whose-turn derivation** `src/lib/game/summary.ts`: `summarizeTurn(match, myId)` → `{ myMove, kind }`
    across lobby (host waiting / ready to start / joiner waiting), draw order, question/answer phases, finished.
    UI maps `kind` → copy; the derivation never needs names. 9 unit tests in `summary.test.ts`.
  - **Migration `00008_my_matches`:** `my_matches()` SECURITY DEFINER RPC — the caller's lobby/active matches
    with `opponent_username`/`opponent_avatar` (profiles are self-readable only, so the list-shaped sibling of
    `match_players`), ordered by `last_activity_at` desc. Returned columns exactly mirror the client-granted
    `MATCH_COLUMNS` — **no secret columns** (integration-tested, plus anon execution denied).
  - **Client hooks** in `src/lib/matches.ts`: `useMyMatches` (RPC fetch + `refetch` + an *unfiltered* Realtime
    subscription on `matches` — membership RLS scopes delivery — that triggers an authoritative refetch on any
    change to any of the caller's games) and `useOnlinePlayers` (cosmetic Supabase Presence on a shared `online`
    channel keyed by clerk id; PRD forbids presence ever affecting outcomes).
  - **Home screen** `src/app/(tabs)/index.tsx`: FlatList of games — `vs <opponent>` (or `Party <code>` while the
    seat is open), whose-turn copy, **Your move** badge + highlighted border when `myMove`, green online dot from
    presence. Tap resumes: `lobby/[id]` for lobbies, `match/[id]` otherwise (all match screens already rehydrate
    authoritatively from Postgres on mount). Refetch on tab focus.
  - **99/99 tests pass** (new live-DB block: list correct for both players incl. open-lobby + opponent identity,
    anon denied, concurrent games independent + activity ordering, finished games drop off, resume rehydrates
    match row/secret/thread/marks via a **fresh client**), `tsc` clean, lint clean, advisors clean (only the
    by-design SECURITY DEFINER WARNs; `my_matches` joins that list). Not yet smoke-tested on device.

- **Issue 9** (push notifications): server-side push, deployed live and verified end-to-end on the wire.
  - **Pure derivation** `supabase/functions/push/derive.ts`: `deriveNotifications(old, new, names)` maps a
    `matches`-row transition to messages — party_joined → host; your_turn → player the move passed to (p2's
    draw turn, coin-flipped first player, wrong-guess turn pass — copy deliberately neutral so it never leaks
    that a guess happened; an answerer's self-created turn is NOT notified); answer_needed → asker's opponent;
    game_ended → both players with win/loss copy; claim_available → the waiting player (via `playerToMove`,
    draw-phase aware). Plus `toExpoMessages` (token attach, tokenless recipients dropped). 13 unit tests in
    `derive.test.ts` cover recipient/token/payload per event type, incl. "chat stays silent".
  - **Edge Function `push`** (`supabase/functions/push/index.ts`, deployed via MCP, `verify_jwt=false`): checks
    the `x-push-secret` header against a Vault secret read through the service-role-only
    `get_push_webhook_secret` RPC (401 otherwise — curl-verified), pre-derives to skip no-op updates, fetches
    both players' `username`/`expo_push_token` with the service role, sends via the Expo push API.
    `index.ts` is excluded from tsconfig (Deno globals); `derive.ts` stays tsc- and jest-covered.
  - **Migrations `00009_push_notifications` + `00010_push_notifications_hardening`:** `matches_notify_push`
    AFTER UPDATE trigger posts secret-stripped old/new rows to the function via `net.http_post` (async — game
    writes never block on push); webhook secret minted randomly straight into Vault (never in the repo);
    `claim_notified` column (not client-readable) + hourly pg_cron scan (`notify-claimable-matches`, :17) flags
    active matches idle 7+ days + BEFORE-UPDATE reset trigger re-arms it on real activity (keyed on
    `last_activity_at`, which the cron flag-set never touches). 00010: pg_net recreated under `extensions`
    (not relocatable → drop/create), `reset_claim_notified` search_path pinned.
  - **Client:** `src/lib/notifications.ts` — `usePushRegistration(profile)` (wired in the home screen; stores
    the Expo token on `profiles.expo_push_token`, skips unchanged, silently no-ops on simulator / Expo Go / no
    EAS projectId / permission denied) and `useNotificationDeepLink` (root layout via `NotificationDeepLinker`;
    routes tapped notifications' `data.url` to `/lobby/[id]` or `/match/[id]`, waits for Clerk on cold start,
    handles each response once). Foreground presentation suppressed (`setNotificationHandler`) per the PRD's
    "when backgrounded" — also what makes game_ended's send-to-both correct. `expo-notifications`/`expo-device`
    installed; `expo-notifications` plugin added to app.json.
  - **114/114 tests pass** (13 derive + 2 new integration: client can write own `expo_push_token`,
    `get_push_webhook_secret` denied to authenticated+anon), `tsc` clean, lint clean, advisors clean (only the
    by-design SECURITY DEFINER WARNs). End-to-end verified: the integration run's live `matches` updates fired
    103 webhook deliveries, all 200 — 74 derived 1 notification, 3 derived 2 (game end → both), 26 correctly
    derived 0; sends were 0 because test profiles hold no tokens (by design — see gotchas).

- **Issue 10** (resign & 7-day inactivity claim): applied to the live DB, Edge Function redeployed (v2),
  verified by the integration suite + a live backdated-claim E2E.
  - **Reducer:** `RESIGN` (immediate forfeit — opponent wins; active-only, draw phase included, never
    turn-gated) and `CLAIM_INACTIVE` (valid only when the *opponent* holds the move per the exported
    `playerToMove` — draw-order aware, answerer during `awaiting_answer` — and `lastActivityAt` is
    `CLAIM_WINDOW_MS` = 7 days stale; time is an event input `now` so the rule stays deterministic). Both end
    the game like a correct guess. New `MatchState.endedReason: 'guess' | 'resign' | 'claim_inactive' | null`
    (guess sets it too). 11 new reducer tests.
  - **Migration `00011_resign_inactivity_claim`:** `matches.ended_reason` column (checked, client-granted —
    the column-explicit SELECT means new columns need their own grant) + backfill of past completions as
    'guess'; `resign(p_match_id)` and `claim_inactive_win(p_match_id)` SECURITY DEFINER RPCs mirroring the
    reducer (`your_move` / `too_early` / `match_not_active` / `not_a_player` error codes); `guess` recreated to
    stamp `ended_reason='guess'`; `my_matches` dropped + recreated to mirror the new column set. Stats trigger
    (00007) and game-ended push (00009) fire for free on the shared status edge — integration-verified.
  - **Push:** `derive.ts` `MatchWebhookRow` gained `ended_reason`; game_ended copy is now phrased per reason
    (resign: "X resigned — the win is yours." / "You resigned…"; claim: "You claimed…" / "X claimed the win
    after 7 days without a move."). 2 new derive tests; `push` Edge Function redeployed (v2) via MCP.
  - **Client:** `src/lib/game/claim.ts` — pure `claimState(match, myId, nowMs)` (`not_applicable` when it's
    your move or the game isn't active; else `countdown {remainingMs}` / `claimable`, built on `summarizeTurn`)
    + `formatRemaining` ("6d 23h"); 7 unit tests. `matches.ts`: `resign()` / `claimInactiveWin()` wrappers,
    `ended_reason` in `MatchRow`/`MATCH_COLUMNS`, and `useMatch` now returns `refetch` — resign/claim refetch on
    success so the actor's own end screen never depends on the realtime round-trip. Match screen: Resign button
    (Alert-confirmed, destructive) in the turn banner and on the draw screen; while waiting on the opponent a
    countdown line ("You can claim the win in 6d 23h", 30s tick) that becomes a confirm-gated "claim the win"
    button; end screen subtitle + push copy phrased by `ended_reason`; reveal cards show "Never drawn" for
    games resigned during the blind draw.
  - **141/141 tests pass** (43 reducer + 7 claim + 15 derive + 7 new integration: resign E2E with atomic stat
    deltas for both players + `ended_reason` readable, either seat can resign, resign during draw, double-resign
    rejected, fresh-game claims rejected `too_early`/`your_move` leaving the game active, anon denied,
    unknown match id). Claim *success* isn't jest-reachable (no service key in test env to backdate), so it was
    verified live once: real match staged via Clerk test users, `last_activity_at` backdated 8 days via MCP
    `execute_sql`, waiting player's `claim_inactive_win` → completed/`claim_inactive`/stats +1W — and the
    webhook derived 2 game_ended messages (all 200s). `tsc` clean, lint clean, advisors clean (only the
    by-design SECURITY DEFINER WARNs; `resign`/`claim_inactive_win` join that list). Not yet smoke-tested on
    device.

- **Issue 11** (random matchmaking): applied to the live DB, verified by the integration suite (incl. the
  concurrency-hammer criterion). **This was the final issue — `issues/` is fully complete.**
  - **Migration `00012_random_matchmaking`:** `matchmaking_queue` (`user_id` PK → profiles, `enqueued_at`,
    `last_seen_at` heartbeat, `matched_match_id`) — RPC-only surface: RLS on with **no policies** and all table
    privileges revoked (advisors now show an intentional INFO "RLS enabled no policy" for it). Two RPCs:
    - `find_random_game()` — one idempotent SECURITY DEFINER call for enqueue AND every poll tick. Concurrency
      scheme (the acceptance criterion): the caller **upserts its own row first** — that row lock is a mutex, so
      two simultaneous scanners skip each other instead of each grabbing the other (never two matches); the
      candidate scan is `FOR UPDATE SKIP LOCKED` over the longest-waiting live row (never the same opponent
      twice); nothing ever waits on a lock, so it's deadlock-free. ⚠️ The **pickup check must run strictly
      AFTER the upsert** (the upsert waits out an in-flight `matched_match_id` stamp and returns it): the first
      draft checked before, and the integration storm test caught a real double-match — a caller could overlook
      an incoming stamp and pair a second time. Pairing creates the match directly (`mode='random'`,
      `status='active'`, server-generated 24-card board, **waiter = player1** so the longest-waiting player
      draws first — no lobby); the waiter learns of it via the stamp on their queue row on their next poll.
      Liveness: candidates must have polled within 30s (no pairing against force-quit searchers); rows stale
      5+ min are GC'd opportunistically.
    - `cancel_matchmaking()` — dequeues; if a pairing already landed it returns that match id instead (the
      opponent is committed to a real game — the client proceeds into it rather than stranding them).
  - **Client:** `src/lib/matchmaking.ts` — RPC wrappers + `useMatchmaking()` (sequential jittered ~2s poll
    loop — jitter matters: perfectly synchronized pollers would SKIP-LOCKED-skip each other forever; cancel
    resolves the cancel-vs-paired race by flipping to `matched`; unmount fire-and-forget dequeues an unmatched
    search). Searching screen `src/app/matchmaking.tsx` (spinner + working Cancel, then a 3s
    "Opponent found: [username]" confirmation via `match_players` before `router.replace` into `/match/[id]`);
    route registered in `_layout.tsx`; "Find a random game" enabled in `new-game.tsx`. No push changes needed:
    the push trigger is AFTER UPDATE and both players are actively in-app when paired.
  - **150/150 tests pass** (9 new integration: pair + waiter pickup, match shape (active/random/24-card
    board/waiter-as-player1/no code), cancel dequeues, cancel-after-pairing returns the match, 6 concurrent
    joins against one waiter create exactly one match, two simultaneously-searching players converge on one
    shared match (sequential jittered loops, modelling the real client — duplicate *concurrent* calls by the
    same user are indistinguishable from a new search and can legitimately re-enqueue), matched game plays the
    standard blind draw into active play + appears in `my_matches` with opponent identity, anon denied, queue
    not client-readable/writable). `tsc` clean, lint clean, advisors clean (by-design SECURITY DEFINER WARNs —
    `find_random_game`/`cancel_matchmaking` join the list — plus the intentional queue INFO above). Not yet
    smoke-tested on device.

- **Issue 12** (design system — first issue of the UI/UX redesign, issues 12–16): the redesign was scoped in a
  grilling session (2026-07-10); direction and vocabulary live in `CONTEXT.md`, per-issue specs in
  `issues/12…16`. Direction: **playful board-game** (warm tabletop palette, tactile pieces, one rich light
  theme; Pokémon flavor via content, not chrome). Presentation layer only — no reducer/RPC/DB changes anywhere
  in 12–16.
  - **`src/ui/`**: `theme.ts` semantic tokens (colors/spacing/radii/shadows/type — hard cardboard shadows on
    iOS, elevation fallback); components `Screen`, `Button` (physical face-on-edge press animation, Reanimated),
    `Card`, `CardModal` (the house overlay pattern — card over dimmed backdrop, tap-outside dismiss),
    `Badge`, `TextField`. Zero new dependencies.
  - **`constants/colors.ts`** is now deprecated aliases re-pointed at theme values, so every unmigrated screen
    picked up the warm palette immediately (incl. router headers/tab bar); each of 13–16 moves its screens onto
    `@/ui` directly, then the alias file dies. `typeColors` is content and stays.
  - **new-game + profile** restyled onto the shared components as the proving ground (full UX rework of those
    flows is still issues 15/16). Verified in the web preview signed in as `rlstest1`: warm palette everywhere,
    3D buttons, player-card profile with stat tiles.
  - `tsc` clean, lint clean, unit suites 92/92 (reducer/stats/review/summary/claim/derive). Integration suites
    untouched (live-DB; presentation-only change). Not yet smoke-tested on a real device.
  - ⚠️ react-native-web logs a `"shadow*" style props are deprecated. Use "boxShadow"` warning — cosmetic,
    web-only; native is the design target (iPhone portrait first, per the grilling decisions).

## Next steps

Issues 1–12 are complete. **Redesign issues remain: 13 (match screen restructure — board on one screen, chat
bubble/modal, turn strip + ADR 0001), 14 (motion), 15 (home + new-game flow), 16 (auth + player card)** — specs
in `issues/`. Other known gaps, in rough priority order:

- **Device smoke tests**: Issues 7, 8, 10 and 11 have never been exercised on a real device (need two players
  mid-match). The full flows are integration-tested against the live DB.
- **Real push delivery**: needs `eas init` (EAS projectId) + a development build — see the gotcha below. The
  entire server pipeline is already live and verified on the wire.
- Possible polish: matchmaking currently allows being paired with someone you already have an active game
  with (fine for a tiny player base — party mode exists for friends); `abandoned` status exists in the schema
  but nothing sets it (resign/claim cover the real cases).

## Gotchas for the new session

- **`expo-notifications` has no web implementation** — its functions throw on `expo start --web`. All entry
  points are guarded: the module-scope `setNotificationHandler` and `getPushTokenOrNull` bail on
  `Platform.OS === 'web'` (note web reports `Device.isDevice = true`), and `NotificationDeepLinker` is only
  mounted on native in `_layout.tsx` (the guard must wrap the *mount* — `useLastNotificationResponse` is a hook
  and can't be called conditionally). Keep any new notification code behind the same guards.
- **Real device pushes need an EAS projectId + dev build.** `getExpoPushTokenAsync` requires
  `extra.eas.projectId` in app.json (not yet configured — run `eas init`), and Expo Go dropped remote-push
  support in SDK 53, so a development build is required. Until then `usePushRegistration` silently no-ops
  (token stays null, server drops the recipient). The whole server pipeline is already live and verified.
- **Never store a real push token on the `rlstest1`/`rlstest2` profiles** — integration tests drive live
  matches through the webhook, and any stored token would receive a flood of real notifications. The
  registration test writes a fake token and nulls it afterwards.
- **Webhook debugging:** delivery results (status + the function's JSON response, e.g. `{"sent":0,"derived":1}`)
  land in `net._http_response`; function-side logs via MCP `get_logs` (service `edge-function`). The trigger is
  fire-and-forget — a down Edge Function never breaks game writes.
- **The push webhook secret lives only in Vault** (`push_webhook_secret`, minted randomly by 00009 — not in the
  repo). The Edge Function reads it via `get_push_webhook_secret` (service_role-only). If it's ever rotated,
  note the function caches it per instance.
- **`matches.claim_notified` is server-only** (not in the client column grant, `MATCH_COLUMNS`, or
  `my_matches`). Issue 10's countdown must derive from `last_activity_at`. The pg_cron job
  `notify-claimable-matches` runs hourly at :17.

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
- **The matchmaking queue must be empty between integration tests** — a leftover row would pair against a
  stale search and make the next test assert nonsense. `matchmaking.test.ts` cancels both users in `afterEach`;
  keep that if you add tests. The paired *matches* it creates stay behind like all the others (gotcha below).
  Note `find_random_game` is deliberately one-search-per-user (PK on `user_id`): duplicate concurrent calls
  from the same user serialize on the row lock, and a call arriving after pickup starts a *new* search.
- **Profiles stat columns are not client-writable** (column-level grants, Issue 6). If a new feature needs to
  write a new profile column from the client, it must be added to the column-level INSERT/UPDATE grant lists —
  a plain `alter table add column` will be readable but not writable by `authenticated`.
- **`draw_secret` returns `void`** deliberately — returning the `matches` row would hand the 2nd drawer the
  opponent's secret. Clients learn their own secret via `my_secret`; the public row update arrives via Realtime.
- If **all MCP/connector calls fail with `net::ERR_FAILED`**: it's the desktop app's Chromium network service
  wedging (VPN-triggered), not the code — fully quit (`Cmd-Q`) and relaunch the app.
