# Pokémon Guess Who

A two-player async mobile game of Guess Who? played with Pokémon: each player blindly draws a secret from a shared 24-card board, then alternates yes/no questions to deduce the opponent's secret.

## Language

### Game

**Match**:
One game between two players, from lobby through completion.
_Avoid_: Game session, room

**Board**:
The 24-card grid both players share in a match. Fits on one screen — never scrolls.
_Avoid_: Grid, deck

**Tile**:
One Pokémon card on the board.
_Avoid_: Card (ambiguous with the secret), cell

**Secret**:
The Pokémon a player blindly drew; what the opponent is trying to deduce.
_Avoid_: Hidden card, target

**Cross-off**:
Flipping one of your own tiles face-down to eliminate it as a candidate. Private to you, reversible, independent of any question.
_Avoid_: Mark, eliminate, strike

**Blind draw**:
The turn-ordered opening phase where each player draws their secret unseen from the board.
_Avoid_: Setup, deal

**Phase**:
Where a match is in its arc: lobby → blind draw → questioning → finished. A player should always know the current phase at a glance.
_Avoid_: Stage, state (overloaded with reducer state)

**Your move**:
The single next action the game is waiting on you for — start, draw, ask, answer, or guess.
_Avoid_: Your turn (a turn can contain several moves, e.g. answer then ask)

**Thread**:
The shared, ordered question-and-answer conversation of a match, visible to both players.
_Avoid_: Chat, messages, history

**Guess**:
Formally naming the opponent's secret. Correct ends the match; wrong costs your turn. Asking and guessing are mutually exclusive in one move.
_Avoid_: Final answer

**Party**:
A private match a host creates for a friend to join by code.
_Avoid_: Lobby (that's the phase), room

### UI

**Chat bubble**:
The floating button on the match screen that opens the thread. Badges/pulses when the thread needs your attention.

**Chat modal**:
The card-style overlay (over the dimmed board) where the thread is read and questions/answers are composed. Auto-presents when you owe an answer; dismissing preserves your draft.

**Turn strip**:
The slim always-visible indicator on the match screen showing the current phase and whose move it is.
_Avoid_: Turn banner (the old bottom-third panel)

**Guess reveal**:
The animated turn-over of the opponent's secret when a guess resolves — the match's emotional payoff.

**Draw ceremony**:
The animated ritual presentation of the blind draw.
