# ADR 0001 — Board owns the viewport; the thread is an overlay

**Status:** Accepted (2026-07-10)
**Context:** UI/UX redesign, issue 13. Source: grilling session 2026-07-10 (see CONTEXT.md).

## Context

The match screen has two competing occupants: the 24-tile board (the game's
working surface — players scan it, cross tiles off, and guess from it) and the
question thread (the game's conversation — asked and answered a few times per
session). The pre-redesign layout docked the thread and its inputs into the
bottom third of the screen, which forced the board into a scrolling grid. The
PRD and CONTEXT.md are explicit that the board must fit on one screen and
never scroll: deduction is a whole-board activity, and a tile hidden below the
fold is a candidate the player forgets.

On an iPhone SE-sized viewport the two cannot coexist: 24 legible tiles plus a
readable thread plus a keyboard-ready input do not fit. One of them had to
lose the viewport. The options considered:

## Options

**1. Docked thread panel (status quo).** Board and thread share the screen
permanently. Rejected: the board is forced to scroll (violating the hard
constraint), and both halves are cramped — the thread shows ~2 messages, the
tiles shrink toward untappable.

**2. Bottom sheet.** The thread lives in a drag-up sheet over the board, with
a collapsed peek state. Rejected: a peek state still permanently taxes the
board's height, a half-open sheet leaves the board in exactly the ambiguous
"partially hidden tiles" state the no-scroll rule exists to prevent, and a
gesture-driven sheet is the most implementation- and motion-heavy option for
no additional capability over a modal.

**3. Sibling screen / tab.** The thread is a separate route the player
navigates to. Rejected: it breaks the core loop — a player reads a question
*while* scanning the board to decide what it eliminates. Navigation also
discards ambient awareness: nothing on the board screen can pulse "you owe an
answer" without duplicating thread state into a banner, and round-tripping a
navigation stack to answer "Yes" is heavy for the game's most frequent action.

**4. Chat bubble → chat modal (chosen).** The board keeps the whole viewport.
The thread is demoted to an overlay: a floating chat bubble on the board opens
a card-style modal (the shared `CardModal` house pattern) over the dimmed
board, containing the full thread, the ask input, and Yes/No quick answers +
answer input.

## Decision

Option 4. The board is the screen; the thread is summoned. The demotion is
made safe by four compensating rules, decided in the grilling session:

- **Auto-open only when you owe an answer.** The modal presents itself when
  (and only when) it becomes the player's move to answer — on entering the
  screen or live when the question arrives. That is the one moment the thread
  *is* the required surface. Your-turn-to-ask never auto-opens (asking is
  optional-timing; the player may want to study the board first) — the bubble
  pulses instead.
- **Attention states on the bubble.** The bubble pulses when the game waits on
  the player (owe an answer, your move to ask) and shows a badge for unread
  opponent activity, so a closed thread is never a silent one.
- **Drafts survive dismissal.** Composing a question mid-thought and peeking
  at the board is the expected loop, so the draft state lives in the screen,
  not the modal — dismiss and reopen never loses composed text.
- **The turn strip stays on the board.** Phase and whose-move are always
  visible without the thread, so closing the modal never costs orientation.

Guessing stays on the board (tap tile → confirm bar) — it is a board action,
not a conversation. The review panel and tile-detail panel adopt the same
`CardModal` overlay, making "card over the dimmed board" the single house
pattern for everything that is not the board.

## Consequences

- All 24 tiles are visible at once down to iPhone SE size; the grid is
  flex-row-based and cannot scroll by construction.
- The thread is one tap away rather than zero. The auto-open rule and bubble
  attention states carry the notification burden the docked panel used to get
  for free; regressions there make questions missable, so they are the
  criteria to test.
- The modal must remain draft-preserving and non-destructive on dismiss —
  future contributors must not "clean up" the draft state into the modal.
- Screen-reader and reachability affordances hang off one floating button;
  the bubble needs an accessibility label and a generous hit target.
- No reducer/RPC/DB changes: this is presentation-layer only, consuming
  `summarizeTurn`, `useMatch`, `useMatchEvents`, `useBoardMarks` as-is.
