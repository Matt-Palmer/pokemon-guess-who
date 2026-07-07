import { reduce } from './reducer';
import { MatchEvent, MatchState } from './types';

/** A match that has been started: shared 24-card board drawn, no secrets yet. */
function activeMatch(overrides: Partial<MatchState> = {}): MatchState {
  return {
    id: 'match_1',
    status: 'active',
    mode: 'party',
    partyCode: 'AB12CD',
    player1Id: 'user_1',
    player2Id: 'user_2',
    player1Secret: null,
    player2Secret: null,
    board: Array.from({ length: 24 }, (_, i) => i + 1),
    currentPlayer: null,
    phase: null,
    winnerId: null,
    firstPlayer: null,
    eliminated: { player1: [], player2: [] },
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    endedAt: null,
    ...overrides,
  };
}

describe('DRAW_SECRET — blind draw', () => {
  test('player 1 draws first and their card becomes their secret', () => {
    const next = reduce(activeMatch(), { type: 'DRAW_SECRET', player: 'player1', pokemonId: 7 });
    expect(next.player1Secret).toBe(7);
    expect(next.player2Secret).toBeNull();
  });

  test('player 2 draws from the remaining pool once player 1 has drawn', () => {
    const afterP1 = reduce(activeMatch(), { type: 'DRAW_SECRET', player: 'player1', pokemonId: 7 });
    const afterP2 = reduce(afterP1, { type: 'DRAW_SECRET', player: 'player2', pokemonId: 12 });
    expect(afterP2.player1Secret).toBe(7);
    expect(afterP2.player2Secret).toBe(12);
  });

  test('the two secrets are always distinct — player 2 cannot draw player 1’s card', () => {
    const afterP1 = reduce(activeMatch(), { type: 'DRAW_SECRET', player: 'player1', pokemonId: 7 });
    expect(() => reduce(afterP1, { type: 'DRAW_SECRET', player: 'player2', pokemonId: 7 })).toThrow(
      /already been drawn/i,
    );
  });

  test('player 2 cannot draw before player 1 (turn order)', () => {
    expect(() => reduce(activeMatch(), { type: 'DRAW_SECRET', player: 'player2', pokemonId: 12 })).toThrow(
      /player 1/i,
    );
  });

  test('a player cannot draw a second secret', () => {
    const afterP1 = reduce(activeMatch(), { type: 'DRAW_SECRET', player: 'player1', pokemonId: 7 });
    expect(() => reduce(afterP1, { type: 'DRAW_SECRET', player: 'player1', pokemonId: 9 })).toThrow(
      /already drawn/i,
    );
  });

  test('a card must be on the board to be drawn', () => {
    expect(() => reduce(activeMatch(), { type: 'DRAW_SECRET', player: 'player1', pokemonId: 999 })).toThrow(
      /not on the board/i,
    );
  });

  test('after both draws the board is face-up and the match is ready for active play', () => {
    const afterP1 = reduce(activeMatch(), { type: 'DRAW_SECRET', player: 'player1', pokemonId: 7 });
    const afterP2 = reduce(afterP1, { type: 'DRAW_SECRET', player: 'player2', pokemonId: 12 });

    // Both secrets assigned and distinct — the derived "face-up / drawing complete" state.
    expect(afterP2.player1Secret).not.toBeNull();
    expect(afterP2.player2Secret).not.toBeNull();
    expect(afterP2.player1Secret).not.toBe(afterP2.player2Secret);
    // All 24 board cards remain in play for guessing (a secret leaves the draw
    // pool, not the board).
    expect(afterP2.board).toHaveLength(24);
  });

  test('secrets can only be drawn during an active match', () => {
    expect(() =>
      reduce(activeMatch({ status: 'lobby' }), { type: 'DRAW_SECRET', player: 'player1', pokemonId: 7 }),
    ).toThrow(/active/i);
  });
});

describe('game reducer skeleton — events not yet implemented', () => {
  const events: MatchEvent[] = [
    { type: 'ASK', player: 'player1', question: 'Is it a fire type?' },
    { type: 'ANSWER', player: 'player2', answer: 'No' },
    { type: 'GUESS', player: 'player1', pokemonId: 6 },
    { type: 'CROSS_OFF', player: 'player1', pokemonId: 6, eliminated: true },
    { type: 'RESIGN', player: 'player2' },
    { type: 'CLAIM_INACTIVE', player: 'player1' },
  ];

  test.each(events)('$type is a recognised event with no logic yet', (event) => {
    expect(() => reduce(activeMatch(), event)).toThrow(`${event.type} not implemented yet`);
  });
});
