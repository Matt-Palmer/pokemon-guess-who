# 14 — Motion: tile flip, guess reveal, draw ceremony, ambient juice

_Ready for agent. Source: UI/UX grilling session, 2026-07-10 (see [CONTEXT.md](../CONTEXT.md)). PRD line 44 (reveal animation) finally lands here._

## What to build

The "feels dead" fix, on Reanimated (already installed). Four layers, all decided in:

1. **Cross-off = tile flip.** Tapping a tile physically flips it face-down (3D
   rotateY, a card-back design on the reverse); tapping again flips it back up.
   Replaces the ✕ overlay. Optimistic marking behavior is unchanged — the flip is
   presentation over the existing `useBoardMarks` state.
2. **Guess reveal sequence.** When a guess resolves: dramatic pause, the secret
   card turns over, win payoff (confetti/scale burst) or wrong-guess sympathy
   (shake), then the end screen / turn pass. Works for both the guesser and the
   opponent watching via Realtime.
3. **Draw ceremony.** The blind draw becomes a ritual: deck presentation, card
   slides out and flips to reveal your secret (only to you).
4. **Ambient juice.** Cards deal onto the board when a match loads, chat bubble
   pulse, turn-strip transitions, screen transitions, subtle press feedback
   everywhere (Button bounce shipped in 12; extend to tiles/rows).

Constraints: 60fps on device (worklets, no JS-thread layout thrash); animations are
interruptible and never gate game correctness — a mid-animation navigation or
Realtime update must not corrupt state. Reduced-motion (`AccessibilityInfo`) falls
back to instant transitions.

## Acceptance criteria

- [ ] Crossing off flips the tile face-down with a card back; un-crossing flips it back. No ✕ overlay remains.
- [ ] A resolving guess plays the reveal sequence for both players before the end state shows (PRD 44).
- [ ] The blind draw presents as a ceremony ending in a you-only secret reveal.
- [ ] Board deal-in, chat-bubble pulse, and turn-strip change animations exist.
- [ ] Animations never block or reorder game writes; interrupting them (navigate away, new Realtime event) leaves state correct.
- [ ] Reduced-motion setting disables the theatrics.
- [ ] `tsc`, lint, tests green.

## Blocked by

- 13 — Match screen restructure
