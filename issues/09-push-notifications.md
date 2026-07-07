# 09 — Push notifications

_Ready for agent. Source: [PRD.md](../PRD.md)._

## What to build

Server-side push notifications so async games don't die silently. Each user's
Expo push token is stored on their profile. A Supabase Edge Function, triggered by
a database webhook on relevant row changes, looks up the recipient's token and
sends the appropriate notification when the app is backgrounded:

- It's now your turn / you need to answer a question.
- A game ended (you won, lost, or the opponent resigned).
- Someone joined your party.
- You can now claim an inactive game.

Standalone per-chat-message pings are deliberately not sent.

## Acceptance criteria

- [ ] The app registers for push and stores the user's Expo push token on their profile.
- [ ] Turn/answer-needed, game-ended, party-joined, and claim-available events each send a notification to the correct recipient.
- [ ] Notifications are sent server-side via an Edge Function triggered by a DB webhook (not from the client).
- [ ] No notification is sent for individual chat messages.
- [ ] Tapping a notification opens the relevant game.
- [ ] Tests: the Edge Function selects the correct recipient/token and payload per event type.

## Blocked by

- 05 — Guessing & win/loss
