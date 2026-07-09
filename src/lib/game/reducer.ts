import { MatchEvent, MatchState, PlayerSlot } from './types';

/** How long the player to move may stall before the opponent can claim the win. */
export const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function other(player: PlayerSlot): PlayerSlot {
  return player === 'player1' ? 'player2' : 'player1';
}

/**
 * The slot that must act next in an active match: draw order first (player 1,
 * then player 2), the answerer during `awaiting_answer`, otherwise the current
 * player. This is who a CLAIM_INACTIVE accuses of stalling — the claim is only
 * valid when the *opponent* of the claimer is the one to move.
 */
export function playerToMove(state: MatchState): PlayerSlot {
  if (state.player1Secret === null) return 'player1';
  if (state.player2Secret === null) return 'player2';
  if (state.phase === 'awaiting_answer') return other(state.currentPlayer ?? 'player1');
  return state.currentPlayer ?? 'player1';
}

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
 * (`completed` + `winnerId` + `endedAt`), so downstream game-end effects (stats,
 * notifications) ride the same status edge. Only an explicit resign forfeits;
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
 * Claim the win from an inactive opponent. Valid only when it is the
 * *opponent's* move ({@link playerToMove} — draw-phase aware, and during
 * `awaiting_answer` the answerer, not the asker, is the one stalling) and
 * nothing has happened for {@link CLAIM_WINDOW_MS} (7 days) since
 * `lastActivityAt`. The claimer wins; the no-show takes the loss.
 */
function claimInactive(state: MatchState, player: PlayerSlot, nowIso: string): MatchState {
  if (state.status !== 'active') {
    throw new Error('Only an active match can be claimed');
  }
  if (playerToMove(state) !== other(player)) {
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
