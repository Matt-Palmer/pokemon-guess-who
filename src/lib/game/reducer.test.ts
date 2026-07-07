import { reduce } from './reducer';
import { MatchEvent, MatchState } from './types';

function emptyMatch(): MatchState {
  return {
    id: 'match_1',
    status: 'lobby',
    mode: 'party',
    partyCode: 'AB12CD',
    player1Id: 'user_1',
    player2Id: 'user_2',
    player1Secret: null,
    player2Secret: null,
    board: [],
    currentPlayer: null,
    phase: null,
    winnerId: null,
    firstPlayer: null,
    eliminated: { player1: [], player2: [] },
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    endedAt: null,
  };
}

describe('game reducer skeleton', () => {
  const events: MatchEvent[] = [
    { type: 'DRAW_SECRET', player: 'player1', pokemonId: 25 },
    { type: 'ASK', player: 'player1', question: 'Is it a fire type?' },
    { type: 'ANSWER', player: 'player2', answer: 'No' },
    { type: 'GUESS', player: 'player1', pokemonId: 6 },
    { type: 'CROSS_OFF', player: 'player1', pokemonId: 6, eliminated: true },
    { type: 'RESIGN', player: 'player2' },
    { type: 'CLAIM_INACTIVE', player: 'player1' },
  ];

  test.each(events)('$type is a recognised event with no logic yet', (event) => {
    expect(() => reduce(emptyMatch(), event)).toThrow(`${event.type} not implemented yet`);
  });
});
