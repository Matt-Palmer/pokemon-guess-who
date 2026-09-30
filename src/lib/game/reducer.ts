import { MatchEvent, MatchState, PlayerSlot } from './types';

/** How long the player to move may stall before the opponent can claim the win. */
export const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function other(player: PlayerSlot): PlayerSlot {
  return player === 'player1' ? 'player2' : 'player1';
}

/**
 * The slot that must act next in an active match: a player who has yet to pick a
 * secret, the answerer during `awaiting_answer`, otherwise the current player.
 *
 * During the secret pick both players can owe a move at once, so this reports
 * only the first of them and is too coarse to gate an inactivity claim on by
 * itself — {@link claimInactive} asks about the opponent specifically. In the
 * turn loop exactly one player ever owes a move, so it stays exact there.
 */
export function playerToMove(state: MatchState): PlayerSlot {
  if (state.player1Secret === null) return 'player1';
  if (state.player2Secret === null) return 'player2';
  if (state.phase === 'awaiting_answer') return other(state.currentPlayer ?? 'player1');
  return state.currentPlayer ?? 'player1';
}

/**
 * Secret pick: each player chooses one card from the face-up shared board as
 * their secret. Picks are simultaneous and independent — neither player waits on
 * the other — and both may land on the same Pokémon. Duplicates are harmless:
 * {@link guess} always compares against the *opponent's* stored secret, so
 * holding the same card as your opponent neither helps nor hinders either of
 * you. A pick is final once made; the client confirms a selection before
 * committing it. Randomness — board generation and the first-turn coin flip —
 * lives in the DB adapter, not this pure reducer, so the rules here stay
 * deterministic and exhaustively testable.
 */
function drawSecret(state: MatchState, player: PlayerSlot, pokemonId: number): MatchState {
  if (state.status !== 'active') {
    throw new Error('Secrets can only be drawn during an active match');
  }
  if (!state.board.includes(pokemonId)) {
    throw new Error('That card is not on the board');
  }

  const ownSecret = player === 'player1' ? state.player1Secret : state.player2Secret;
  if (ownSecret !== null) {
    throw new Error('You have already drawn your secret');
  }

  return {
    ...state,
    player1Secret: player === 'player1' ? pokemonId : state.player1Secret,
    player2Secret: player === 'player2' ? pokemonId : state.player2Secret,
    lastActivityAt: new Date().toISOString(),
  };
}

/**
 * Ask the current turn's free-text question. Only the player whose turn it is may
 * ask, and only while a question is expected. The turn does not pass yet — the
 * asker stays `currentPlayer` and the phase flips to `awaiting_answer` so the
 * *opponent* is the one prompted to respond. The question text itself is not held
 * in this state; it lives in the persisted `match_events` thread.
 */
function ask(state: MatchState, player: PlayerSlot, question: string): MatchState {
  if (state.status !== 'active') {
    throw new Error('Questions can only be asked during an active match');
  }
  if (state.phase !== 'awaiting_question') {
    throw new Error('A question is not expected right now');
  }
  if (state.currentPlayer !== player) {
    throw new Error('It is not your turn to ask');
  }
  if (question.trim().length === 0) {
    throw new Error('A question cannot be empty');
  }

  return {
    ...state,
    phase: 'awaiting_answer',
    lastActivityAt: new Date().toISOString(),
  };
}

/**
 * Answer the pending question. Only the opponent of the asker (i.e. *not* the
 * current player) may answer, and only while an answer is expected. Answering
 * passes the turn: the answerer becomes `currentPlayer` and the phase returns to
 * `awaiting_question`.
 */
function answer(state: MatchState, player: PlayerSlot, text: string): MatchState {
  if (state.status !== 'active') {
    throw new Error('Answers can only be given during an active match');
  }
  if (state.phase !== 'awaiting_answer') {
    throw new Error('There is no question to answer');
  }
  if (state.currentPlayer === player) {
    throw new Error('The asking player cannot answer their own question');
  }
  if (text.trim().length === 0) {
    throw new Error('An answer cannot be empty');
  }

  return {
    ...state,
    currentPlayer: player,
    phase: 'awaiting_question',
    lastActivityAt: new Date().toISOString(),
  };
}

/**
 * Cross off (or un-cross) a card on the acting player's *own* board. These marks
 * are private — they never touch the opponent's list and give away no
 * information — and are deliberately NOT turn-gated: a player may re-mark their
 * board at any point during an active match, on or off their turn.
 */
function crossOff(
  state: MatchState,
  player: PlayerSlot,
  pokemonId: number,
  eliminated: boolean,
): MatchState {
  if (state.status !== 'active') {
    throw new Error('Cards can only be crossed off during an active match');
  }
  if (!state.board.includes(pokemonId)) {
    throw new Error('That card is not on the board');
  }

  const marks = state.eliminated[player];
  const nextMarks = eliminated
    ? marks.includes(pokemonId)
      ? marks
      : [...marks, pokemonId]
    : marks.filter((id) => id !== pokemonId);

  return {
    ...state,
    eliminated: { ...state.eliminated, [player]: nextMarks },
  };
}

/**
 * Guess the opponent's secret. Offered instead of asking, so it is gated exactly
 * like {@link ask}: only the current player, only while a question is expected —
 * you may ask XOR guess on your turn, never both. The guess is validated against
 * the opponent's stored secret:
 *  - Correct → the guesser wins and the match ends (`completed` + `winnerId` +
 *    `endedAt`).
 *  - Wrong → the missed card is auto-crossed on the *guesser's own* board (a
 *    private mark) and the turn passes to the opponent, back to `awaiting_question`.
 *
 * A wrong guess only ever mutates the guesser's own `eliminated` list and flips
 * the turn — the same signal a normal answer produces — so what was guessed, and
 * that a guess happened at all, stays private to the guesser.
 */
function guess(state: MatchState, player: PlayerSlot, pokemonId: number): MatchState {
  if (state.status !== 'active') {
    throw new Error('Guesses can only be made during an active match');
  }
  if (state.phase !== 'awaiting_question') {
    throw new Error('You can only guess at the start of your turn');
  }
  if (state.currentPlayer !== player) {
    throw new Error('It is not your turn to guess');
  }
  if (!state.board.includes(pokemonId)) {
    throw new Error('That card is not on the board');
  }

  const opponent: PlayerSlot = player === 'player1' ? 'player2' : 'player1';
  const opponentSecret = opponent === 'player1' ? state.player1Secret : state.player2Secret;
  const now = new Date().toISOString();

  if (pokemonId === opponentSecret) {
    return {
      ...state,
      status: 'completed',
      winnerId: player === 'player1' ? state.player1Id : state.player2Id,
      endedReason: 'guess',
      endedAt: now,
      lastActivityAt: now,
    };
  }

  const marks = state.eliminated[player];
  const nextMarks = marks.includes(pokemonId) ? marks : [...marks, pokemonId];
  return {
    ...state,
    eliminated: { ...state.eliminated, [player]: nextMarks },
    currentPlayer: opponent,
    phase: 'awaiting_question',
    lastActivityAt: now,
  };
}

/**
 * Resign: an immediate forfeit, available to either player at any point in an
 * active match (draw phase included) and never turn-gated — you can always walk
 * away. The opponent wins and the match ends exactly like a correct guess
 * (`completed` + `winnerId` + `endedAt`), so downstream game-end effects (stats)
 * ride the same status edge. Only an explicit resign forfeits;
 * a disconnect or app-close leaves the match active and resumable.
 */
function resign(state: MatchState, player: PlayerSlot): MatchState {
  if (state.status !== 'active') {
    throw new Error('Only an active match can be resigned');
  }

  const now = new Date().toISOString();
  return {
    ...state,
    status: 'completed',
    winnerId: player === 'player1' ? state.player2Id : state.player1Id,
    endedReason: 'resign',
    endedAt: now,
    lastActivityAt: now,
  };
}

/**
 * Claim the win from an inactive opponent. Valid only while the *opponent* is
 * the one holding things up, and nothing has happened for
 * {@link CLAIM_WINDOW_MS} (7 days) since `lastActivityAt`. The claimer wins; the
 * no-show takes the loss.
 *
 * "Holding things up" is asked two ways. During the secret pick both players can
 * owe a move simultaneously, so the only question is whether the opponent has
 * yet to pick — your own pick is irrelevant, and waiting on each other for a
 * week should not leave the claim available to just one of you. In the turn loop
 * exactly one player owes a move, so {@link playerToMove} answers it (during
 * `awaiting_answer` that is the answerer, not the asker).
 */
function claimInactive(state: MatchState, player: PlayerSlot, nowIso: string): MatchState {
  if (state.status !== 'active') {
    throw new Error('Only an active match can be claimed');
  }
  const opponent = other(player);
  const opponentSecret = opponent === 'player1' ? state.player1Secret : state.player2Secret;
  const picking = state.player1Secret === null || state.player2Secret === null;
  if (picking ? opponentSecret !== null : playerToMove(state) !== opponent) {
    throw new Error('You can only claim while waiting on your opponent');
  }
  if (Date.parse(nowIso) - Date.parse(state.lastActivityAt) < CLAIM_WINDOW_MS) {
    throw new Error('Your opponent still has time to move');
  }

  return {
    ...state,
    status: 'completed',
    winnerId: player === 'player1' ? state.player1Id : state.player2Id,
    endedReason: 'claim_inactive',
    endedAt: nowIso,
    lastActivityAt: nowIso,
  };
}

export function reduce(state: MatchState, event: MatchEvent): MatchState {
  switch (event.type) {
    case 'DRAW_SECRET':
      return drawSecret(state, event.player, event.pokemonId);
    case 'ASK':
      return ask(state, event.player, event.question);
    case 'ANSWER':
      return answer(state, event.player, event.answer);
    case 'CROSS_OFF':
      return crossOff(state, event.player, event.pokemonId, event.eliminated);
    case 'GUESS':
      return guess(state, event.player, event.pokemonId);
    case 'RESIGN':
      return resign(state, event.player);
    case 'CLAIM_INACTIVE':
      return claimInactive(state, event.player, event.now ?? new Date().toISOString());
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
