# PRD: Pokémon Guess Who — Async Multiplayer Deduction Game

## Problem Statement

I want to play a *Guess Who?*–style deduction game with friends and strangers,
using Pokémon, on my phone — with the other player on a different phone,
potentially in a different location. Existing Guess Who games are same-device or
don't exist for Pokémon, and I want games I can pick up and put down over days
rather than having to sit through a single live session. I also want to build a
personal record of how I'm doing over time.

## Solution

A React Native (Expo) mobile app where two players deduce each other's secret
Pokémon across separate phones. Players sign in, then either start a private
party (sharing a code with someone they know) or get matched with a random
opponent. Each game draws a shared 24-card board of Pokémon; each player is
blindly assigned one card as their secret. Players take strict alternating turns,
asking free-text questions over chat and crossing off cards on their own board
until they're ready to guess. Guesses are validated instantly by the server. The
first player to guess their opponent's secret wins.

Games are **asynchronous and long-lived**: a player can close the app and resume
any of their many concurrent games later, prompted by push notifications when
it's their move. Each completed game updates the player's personal stats.

## User Stories

### Authentication & Profile
1. As a new player, I want to sign up with an account, so that my games and stats persist across sessions and devices.
2. As a returning player, I want to sign in, so that I can resume my existing games and see my history.
3. As a player, I want a username and avatar, so that opponents can recognize me.
4. As a player, I want a profile screen showing my stats, so that I can track how I'm improving.
5. As a player, I want my games-played, wins, losses, win rate, current streak, and best streak displayed, so that I understand my performance at a glance.

### Home / Games List
6. As a player, I want a list of all my active games, so that I can manage multiple games at once.
7. As a player, I want each game in the list to show my opponent and whose turn it is, so that I know where my attention is needed.
8. As a player, I want games where it's my move to be visually highlighted, so that I can quickly find the games waiting on me.
9. As a player, I want a prominent "New Game" action, so that I can start playing without hunting through menus.

### Starting a Game — Private Party
10. As a player, I want to start a private party, so that I can play with someone I already know.
11. As a host, I want to receive a short, human-readable party code, so that I can share it verbally or by message.
12. As a host, I want a "copy code" button, so that I can share the code easily.
13. As a host, I want a lobby screen showing "waiting for opponent," so that I know the party is live and waiting.
14. As a host, I want to see my opponent's username/avatar once they join, so that I can confirm the right person joined.
15. As a host, I want a "Start" button once someone has joined, so that I control when the game begins.
16. As a joining player, I want to enter a party code, so that I can join a friend's game.
17. As a joining player, I want a clear error if the code is invalid, full, or already in progress, so that I understand why I couldn't join.

### Starting a Game — Random Matchmaking
18. As a player, I want to find a random opponent, so that I can play even when no friends are available.
19. As a player, I want a "searching for opponent" screen with a cancel button, so that I'm not stuck waiting indefinitely.
20. As a player, I want to be paired with the person who's been waiting longest, so that matchmaking is fair and quick.
21. As a player, I want a brief "opponent found: [username]" confirmation before the game starts, so that the transition isn't jarring.
22. As a player, I want to never be paired with two opponents at once, so that matchmaking is reliable.

### Board Setup & Blind Draw
23. As a player, I want a shared board of 24 Pokémon drawn from all 1025, so that every game feels fresh.
24. As a player, I want the board generated on the server so both of us see the identical 24 cards, so that the game is fair.
25. As a player, I want the cards laid out face-down at the start, so that the secret assignment feels like a genuine draw.
26. As a player, I want to blindly select a face-down card as my secret, so that neither of us can cherry-pick an unfairly hard Pokémon.
27. As a player, I want my drawn secret revealed only to me, so that my opponent doesn't know what they're guessing.
28. As a player, I want my drawn card removed so my opponent can't draw the same one, so that our secrets are always different.
29. As a player, I want all 24 cards to flip face-up when the game begins, so that I can start deducing my opponent's secret.

### Core Gameplay — Turns, Questions, Board
30. As a player, I want strict alternating turns, so that the game is fair and structured.
31. As a player, I want to know clearly whose turn it is, so that I know when I can act.
32. As a player, I want to, on my turn, either ask one question OR make one guess (never both), so that turns are balanced.
33. As a player, I want to type free-text questions to my opponent, so that I can ask anything about their Pokémon.
34. As the asker, I want my opponent to answer my question before my turn ends, so that I get information each turn.
35. As the answerer, I want to be prompted to answer my opponent's question, so that I know an action is required of me.
36. As a player, I want to see the full running thread of questions and answers, so that I can reason about the game.
37. As a player, I want to cross off / hide cards on my own board at any time, not just on my turn, so that I can manage my deductions freely.
38. As a player, I want my crossed-off cards to be private, so that my opponent gains no information from my board state.
39. As a player, I want crossing off a card to be independent of the questions I asked, so that I decide for myself which cards to eliminate.
40. As a player, I want to tap a card to expand its details (type, generation), so that I can form and reason about questions even if I don't have every Pokémon memorized.

### Guessing & Winning
41. As a player, I want to guess by selecting one of my remaining face-up cards, so that guessing is quick and visual.
42. As a player, I want my guess validated instantly by the server, so that a correct guess can't be denied and I don't have to wait on my opponent.
43. As a player, I want a correct guess to end the game with me as the winner, so that there's a clear resolution.
44. As a player, I want a reveal animation when a guess resolves, so that it still feels like the opponent's card is being turned over.
45. As a player, I want a wrong guess to only cost me my turn (not the game), so that I can keep playing and deducing.
46. As a player, I want a wrongly-guessed card auto-crossed-off on my own board, so that I at least eliminate it for having spent a turn.
47. As a player, I want my guesses (right or wrong) hidden from my opponent, so that I don't leak my reasoning.
48. As a player, I want the game to continue until someone guesses correctly, so that games are decided by deduction, not attrition.

### Wrong-Guess Review
49. As a player who guessed wrong, I want to review all the cards I've crossed off, so that I can reconsider my deductions.
50. As a player who guessed wrong, I want to review the questions I've asked and their answers, so that I can work out the answer based on prior responses.
51. As a player, I want the review available as an in-game panel over the board, so that I can consult it while deciding my next guess.

### Async Play & Multiple Games
52. As a player, I want to close the app mid-game and resume later exactly where I left off, so that I can play at my own pace.
53. As a player, I want to have many games running simultaneously, so that I'm never waiting on a single opponent.
54. As a player, I want to reopen a game and see its exact prior state, so that closing the app never loses progress.

### Notifications
55. As a player, I want a push notification when it becomes my turn, so that I remember to make my move.
56. As a player, I want a push notification when I need to answer my opponent's question, so that I don't stall the game.
57. As a player, I want a notification when a game ends (I won, lost, or opponent resigned), so that I know the outcome.
58. As a host, I want a notification when someone joins my party, so that I can start the game.
59. As a player, I want a notification when I can claim an inactive game, so that ghosted games don't linger.
60. As a player, I want to NOT be notified for every individual chat message, so that notifications aren't spammy.

### Leaving, Disconnects & Inactivity
61. As a player, I want to resign a game, so that I can exit a game I no longer want to play.
62. As a player, I want resigning to count as a forfeit/loss and give my opponent the win, so that people can't rage-quit to dodge losses.
63. As a player, I want to see when my opponent is currently online, so that I know if a live back-and-forth is possible.
64. As a player, I want a game to remain intact if my opponent disconnects, so that a dropped connection doesn't end our game.
65. As a player waiting on an inactive opponent, I want to see a countdown to when I can end the game, so that I know how long until I can claim it.
66. As a player, I want to claim a win if my opponent hasn't moved for 7 days, so that I'm not stuck in a dead game.
67. As a player, I want a claimed inactive game to count as my win and their loss, so that ghosting is discouraged.

### Stats & Records
68. As a player, I want each completed game to update my stats, so that my record stays current.
69. As a player, I want forfeits and 7-day claims reflected correctly in wins/losses, so that my record is accurate.
70. As a player, I want my current and best win streaks tracked, so that I have a goal to chase.

## Implementation Decisions

### Platform & Stack
- **React Native + Expo**, using `expo-router` for navigation and `expo-image` for sprite rendering (mirroring the existing `pokequiz` app's stack conventions).
- **Clerk** for authentication (sign-up, sign-in, session management).
- **Supabase (Postgres + Realtime)** as the backend database and realtime layer.
- **Clerk ↔ Supabase integration** via Supabase third-party auth: the Supabase client is constructed with an `accessToken` callback that returns Clerk's session JWT on every request. RLS policies read the Clerk user id from `auth.jwt() ->> 'sub'`. Supabase Realtime Authorization honours the same token, so game channels are locked to their two players.

### Realtime Sync — Hybrid Model
- **Authoritative game state lives in Postgres** and syncs via **Postgres Changes** subscriptions — durable, reconnection-safe, and cheat-resistant via RLS.
- **Broadcast** is used only for low-latency ephemeral niceties (e.g., typing indicators).
- **Presence** is **cosmetic only** — an "online now" indicator. It does **not** trigger any forfeit.
- Because the game is turn-based and async, latency is non-critical; durability and simplicity win.

### Game Model — Pure Reducer (primary seam)
The entire match is modelled as a pure function `(matchState, event) => matchState`. Events: `DRAW_SECRET`, `ASK`, `ANSWER`, `GUESS`, `CROSS_OFF`, `RESIGN`, `CLAIM_INACTIVE`. All game logic lives here; Supabase and React Native are thin adapters. The reducer owns:
- Blind-draw secret assignment (opponent's drawn card removed from the pool so secrets are always distinct).
- Turn/phase transitions.
- Guess auto-validation.
- Wrong-guess handling (auto-cross the missed card on the guesser's own board; pass turn).
- Win/loss determination.
- Streak/stat deltas.

### Board & Blind Draw
- Board = **24 Pokémon** drawn randomly from the seeded reference set, **generated server-side** so both players see the identical board.
- Cards start **face-down**; player 1 blindly selects a card (their secret, revealed only to them), which is **removed** from the pool; player 2 then selects from the remaining 23.
- On game start, **all 24 cards flip face-up** for both players.
- Secrets are drawn from the shared board (not freely chosen from all 1025).

### Turn Cycle
- Strict alternating turns. A match tracks `current_player` and `phase` (`awaiting_question` | `awaiting_answer`).
- On your turn you **ask a question XOR make a guess**.
- **If you guess:** server auto-validates. If wrong, the missed card is auto-crossed on your own board and the turn passes to your opponent. If correct, you win and the game ends.
- **If you ask:** `phase → awaiting_answer`; your opponent is prompted (and notified) to answer. When they answer, the answer is shown to you and the turn passes to them (`current_player = opponent`, `phase = awaiting_question`).
- **Crossing off / hiding cards is NOT turn-gated** — a private, untimed, anytime action on your own board. Only asking and guessing are turn-gated.
- Who takes the **first turn** is decided by a random coin flip at game start.
- Wrong guesses (and what was guessed) are fully private to the guesser.

### Entry Paths
- **Private party:** host creates a party and receives a **6-character alphanumeric code** excluding ambiguous characters (0/O, 1/I/L), unique among currently-active parties (recycled after a game ends). Host waits in a lobby, sees the joiner, and presses **Start**. Joining with an invalid/full/in-progress code shows a clear error.
- **Random matchmaking:** first-come-first-served. A `matchmaking_queue` table plus an **atomic Postgres RPC** pairs the enqueuing player with the oldest waiting opponent, using row locking to prevent two players grabbing the same opponent (concurrency correctness is the point). "Searching…" screen with Cancel (removes from queue). On pairing, a brief 3-second "Opponent found: [username]" confirmation precedes the blind draw.

### Async Lifecycle & Abandonment
- Games are **async and long-lived**; closing the app is normal and never forfeits. State in Postgres makes rejoin-in-place trivial.
- **Explicit resign** = immediate forfeit + loss; opponent wins.
- **Inactivity:** if it's a player's turn and they haven't moved for **7 days**, the opponent may **claim the win** (counts as the no-show's loss). A visible countdown communicates when the claim becomes available.

### Pokémon Data
- A **`pokemon` reference table** is seeded once from the PokéAPI: all 1025 rows with `id`, `name`, `sprite_url`, `types[]`, `generation`.
- Board generation reads random rows from this table server-side (no live PokéAPI calls per game).
- Cards use PokéAPI **official artwork**; `expo-image` handles client-side image caching.
- Cards show sprite + name, with **tap-to-expand details** (type, generation) as a reference aid; opponents still answer questions manually from their own knowledge.

### Notifications
- Each user's **Expo push token** is stored on their profile.
- Notifications are sent **server-side** via a **Supabase Edge Function** triggered by a database webhook when relevant rows change.
- Notified events (when backgrounded): **your turn / answer needed**, **game ended**, **party joined**, **claim available**. Standalone per-chat-message pings are **not** sent.

### Stats
- Core stats per profile: **games played, wins, losses, win rate (derived), current streak, best streak**.
- Stored as **denormalized counters** on the profile, backed by an authoritative **match history** (`matches` + `match_events`), updated on game-end (trigger or Edge Function).
- Deferred stats (data captured so they can be added later without migration): average turns-to-win, guess accuracy, favourite Pokémon, head-to-head records.

### Schema (Postgres)
- **`profiles`** — `clerk_id` (PK), `username`, `avatar`, `expo_push_token`, `games_played`, `wins`, `losses`, `current_streak`, `best_streak`.
- **`pokemon`** — `id`, `name`, `sprite_url`, `types[]`, `generation` (seeded reference, all 1025).
- **`matches`** — `id`, `status` (lobby/active/completed/abandoned), `mode` (party/random), `party_code`, `player1_id`, `player2_id`, `player1_secret`, `player2_secret`, `board[]` (24 pokemon ids), `current_player`, `phase`, `winner_id`, `first_player`, `created_at`, `last_activity_at`, `ended_at`.
- **`match_events`** — append-only log: `id`, `match_id`, `actor_id`, `type` (question/answer/guess), `payload`, `created_at`. Drives the chat/question history (needed for wrong-guess review) and realtime sync.
- **`board_marks`** — each player's private eliminated cards: `match_id`, `player_id`, `eliminated[]`.
- **`matchmaking_queue`** — `user_id`, `enqueued_at`.

### Navigation
- Bottom tabs: **Games** (active-games list with whose-turn indicators + "New Game") and **Profile** (stats).
- "New Game" sheet: **Start a party**, **Join a party**, **Find a random game**.
- Stack screens: **Game screen** (turn banner, 24-card board, chat thread, message input) and the **wrong-guess review as an in-game panel** overlaying the board (not a separate route).
- Clerk gates the tabs: unauthenticated users see auth screens; authenticated users land on Games.

## Testing Decisions

- **Good tests exercise external behavior, not implementation details.** For the game engine, that means asserting on resulting `matchState` given a sequence of events — never on internal helpers or private structure. Tests should read as game scenarios (draw → ask → answer → guess wrong → guess right → win).
- **Primary seam — the pure game-rules reducer** (`(matchState, event) => matchState`) is tested exhaustively with no network or device. Coverage includes: blind-draw producing distinct secrets; turn/phase transitions for ask→answer and guess paths; guess auto-validation (correct ends game, wrong auto-crosses the missed card and passes turn); crossing-off being un-gated and private; first-turn coin flip; resign → forfeit/loss; 7-day inactivity claim → win/loss; and streak/stat deltas on game-end.
- **Secondary seam — Supabase RPC integration tests** against a test database for the atomic/race-sensitive operations: server-side board generation (identical shared board), party create/join (code uniqueness, full/in-progress rejection), and especially matchmaking pairing under concurrency (two enqueuing players never grab the same opponent). The concurrency *is* the behavior, so these can't collapse into the reducer.
- **Prior art:** none in this greenfield project. The reducer-scenario style should be established here as the pattern for future game-logic tests.
- Everything above these seams (Edge Function notifications, UI screens) is exercised through them and is not separately unit-tested in the first pass.

## Out of Scope

- **Build order / phasing** — deliberately deferred; not part of this PRD.
- **Turn timers** during active play — intentionally omitted; the async model + 7-day inactivity claim covers stalling.
- **Skill/ELO-based matchmaking** — first-come-first-served only for now.
- **Deep-link "tap to join" party invites** — codes are shared/entered manually; deep links are a later enhancement.
- **Automatic answer verification / attribute-based auto-elimination** — questions are free-text and answered manually by the opponent; the system does not referee answers or auto-cross cards from questions.
- **Manual accept/reject of guesses** — replaced by server auto-validation.
- **Deferred stats** — average turns-to-win, guess accuracy, favourite Pokémon, head-to-head.
- **Standalone chat-message push notifications.**
- **Card-flip / reveal animation polish, empty/error-state polish** — desirable but not core behavior.

## Further Notes

- The design deliberately diverges from classic *Guess Who?* in that secrets are **blindly drawn** from the shared board rather than deliberately chosen, and eliminations are **manual and independent** of the questions asked. Both were explicit decisions.
- Because each board is 24 random Pokémon (rather than a balanced set), question difficulty will swing — a type question might eliminate many cards or none. This is accepted as a characteristic of the game, not a bug.
- The reducer being the single source of truth for game logic is the central architectural bet: it keeps the game testable without a network, and lets Supabase/React Native remain thin adapters. Realtime, persistence, and notifications all sit around it, not inside it.
- Clerk-as-auth-provider means all RLS (including Realtime channel authorization) keys off the Clerk `sub` claim rather than Supabase's native `auth.uid()` — a small but pervasive detail to get right early.
