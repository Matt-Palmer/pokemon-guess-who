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

export function reduce(state: MatchState, event: MatchEvent): MatchState {
  switch (event.type) {
    case 'DRAW_SECRET':
      return drawSecret(state, event.player, event.pokemonId);
    case 'ASK':
    case 'ANSWER':
    case 'GUESS':
    case 'CROSS_OFF':
    case 'RESIGN':
    case 'CLAIM_INACTIVE':
      throw new Error(`${event.type} not implemented yet`);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
