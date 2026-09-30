# 17 — Same-room (local) mode

_Source: [PRD.md](../PRD.md) · [CONTEXT.md](../CONTEXT.md)._

## What to build

A third game mode for two people sitting in the same room, on two phones. It is
a digital version of the physical board rather than a variant of the async game:
players pick a secret exactly as they do online, then the app gets out of the
way. Questions and answers happen out loud, so there are no turns, no thread and
no in-app guessing.

A match ends when a player reveals **their own** secret — how you confirm an
opponent's correct spoken guess. Nobody wins on the record: the app never saw a
guess, so `winner_id` stays null and no profile stats move.

## Acceptance criteria

- [x] A local party is created from the party modal ("Play in the same room"); the joiner inherits the mode via the same code and lobby.
- [x] Both players pick a secret exactly as in an online match.
- [x] Play has no turns: `phase`, `current_player` and `first_player` stay null, and no coin flip fires.
- [x] The board, the view toggle, private cross-offs and the secret chip all work; the chat bubble, guess flow, resign and review are absent.
- [x] `reveal_my_secret` discloses only the caller's own secret, ends the match with `ended_reason = 'revealed'` and no winner, and is rejected on a non-local match or before the caller has picked.
- [x] Both players can read both secrets afterwards via the existing `match_result` RPC.
- [x] A winnerless completion leaves both players' stats untouched.
- [x] The inactivity claim is rejected during local play, and still applies during the secret pick.

## Notes

- **Two devices, not pass-and-play.** One shared device would mean one Clerk
  identity for two players, and secret privacy would stop being an RLS concern
  and become a UI one — effectively a parallel implementation of the match model.
- **Owner-triggered reveal.** A shared reveal button either player could press on
  the *other's* card would let anyone peek at any moment.
- **Self-reported winners** (and therefore local-game stats) were considered and
  left out: it needs a two-device agreement handshake to be trustworthy. Additive
  later — nothing here blocks it.

## Blocked by

- 16 — Auth and player card
