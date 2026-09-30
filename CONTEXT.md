# Pokémon Guess Who

A two-player async mobile game of Guess Who? played with Pokémon: each player picks a secret from a shared 24-card board, then alternates yes/no questions to deduce the opponent's secret.

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

**Secret pick**:
The opening phase where each player chooses their secret from the face-up board. Simultaneous — neither player waits on the other — and the two may land on the same Pokémon.
_Avoid_: Blind draw (the superseded turn-ordered, face-down version), setup, deal

**Phase**:
Where a match is in its arc: lobby → secret pick → questioning → finished. A player should always know the current phase at a glance.
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

**Local game**:
A match between two people in the same room, on two phones. Same board, same secret pick, same private cross-offs — but no turns, no thread and no in-app guessing, because the questions are asked out loud. Ends when a player reveals their own secret.
_Avoid_: Same-room mode (fine in UI copy, but `local` is the mode value), pass-and-play (that's one device, which this is not)

**Reveal**:
Turning your own secret face-up for your opponent, which ends a local game. Only ever your own card — a button that showed your opponent's would just be a peek.
_Avoid_: Show, concede

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

**Pick ceremony**:
The beat after you lock your secret in: the board falls away, your card takes the centre of the screen, and it doubles as the waiting state until play opens.
_Avoid_: Draw ceremony
