import { MatchEvent, MatchState, PlayerSlot } from './types';

/**
 * Blind draw: a player secretly draws one card from the shared board. Player 1
 * draws first; player 2 then draws from the remaining pool, so the two secrets
 * are always distinct. The drawn card leaves the *draw pool* (it can't be drawn
 * again) but stays on the board for guessing. Randomness — board generation and
 * the first-turn coin flip — lives in the DB adapter, not this pure reducer, so
 * the rules here stay deterministic and exhaustively testable.
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

  if (player === 'player2') {
    if (state.player1Secret === null) {
      throw new Error('Waiting for player 1 to draw first');
    }
    if (pokemonId === state.player1Secret) {
      throw new Error('That card has already been drawn');
    }
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
    case 'RESIGN':
    case 'CLAIM_INACTIVE':
      throw new Error(`${event.type} not implemented yet`);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
