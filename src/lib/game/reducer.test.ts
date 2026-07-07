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

/** A match in active play with both secrets drawn and it being `first`'s turn to ask. */
function playingMatch(first: 'player1' | 'player2' = 'player1', overrides: Partial<MatchState> = {}): MatchState {
  return activeMatch({
    player1Secret: 7,
    player2Secret: 12,
    firstPlayer: first,
    currentPlayer: first,
    phase: 'awaiting_question',
    ...overrides,
  });
}

describe('ASK / ANSWER — the turn loop', () => {
  test('the current player asks; the phase moves to awaiting_answer with the turn unchanged', () => {
    const next = reduce(playingMatch('player1'), {
      type: 'ASK',
      player: 'player1',
      question: 'Is it a fire type?',
    });
    expect(next.phase).toBe('awaiting_answer');
    // The asker is still the current player — the *opponent* is the one who must act now.
    expect(next.currentPlayer).toBe('player1');
  });

  test('a player cannot ask when it is not their turn', () => {
    expect(() =>
      reduce(playingMatch('player1'), { type: 'ASK', player: 'player2', question: 'Is it blue?' }),
    ).toThrow(/not your turn/i);
  });

  test('a player cannot ask while an answer is still pending', () => {
    const afterAsk = reduce(playingMatch('player1'), {
      type: 'ASK',
      player: 'player1',
      question: 'Is it a fire type?',
    });
    expect(() =>
      reduce(afterAsk, { type: 'ASK', player: 'player1', question: 'Is it big?' }),
    ).toThrow(/not expected|awaiting/i);
  });

  test('an empty question is rejected', () => {
    expect(() =>
      reduce(playingMatch('player1'), { type: 'ASK', player: 'player1', question: '   ' }),
    ).toThrow(/empty/i);
  });

  test('the opponent answers; the turn passes to them and the phase returns to awaiting_question', () => {
    const afterAsk = reduce(playingMatch('player1'), {
      type: 'ASK',
      player: 'player1',
      question: 'Is it a fire type?',
    });
    const afterAnswer = reduce(afterAsk, { type: 'ANSWER', player: 'player2', answer: 'No' });
    expect(afterAnswer.phase).toBe('awaiting_question');
    expect(afterAnswer.currentPlayer).toBe('player2');
  });

  test('the asking player cannot answer their own question', () => {
    const afterAsk = reduce(playingMatch('player1'), {
      type: 'ASK',
      player: 'player1',
      question: 'Is it a fire type?',
    });
    expect(() => reduce(afterAsk, { type: 'ANSWER', player: 'player1', answer: 'Yes' })).toThrow(
      /own question|not your turn/i,
    );
  });

  test('cannot answer when no question is pending', () => {
    expect(() =>
      reduce(playingMatch('player1'), { type: 'ANSWER', player: 'player2', answer: 'No' }),
    ).toThrow(/no question|awaiting_question/i);
  });

  test('a full round trips the turn from player1 to player2 and back', () => {
    let s = playingMatch('player1');
    s = reduce(s, { type: 'ASK', player: 'player1', question: 'Fire?' });
    s = reduce(s, { type: 'ANSWER', player: 'player2', answer: 'No' });
    // Now it is player2's turn to ask.
    s = reduce(s, { type: 'ASK', player: 'player2', question: 'Water?' });
    s = reduce(s, { type: 'ANSWER', player: 'player1', answer: 'Yes' });
    expect(s.currentPlayer).toBe('player1');
    expect(s.phase).toBe('awaiting_question');
  });
});

describe('CROSS_OFF — private board marks', () => {
  test('a player can cross off a card on their own board', () => {
    const next = reduce(playingMatch('player1'), {
      type: 'CROSS_OFF',
      player: 'player1',
      pokemonId: 3,
      eliminated: true,
    });
    expect(next.eliminated.player1).toContain(3);
    expect(next.eliminated.player2).toEqual([]);
  });

  test('un-crossing removes the mark', () => {
    const crossed = reduce(playingMatch('player1'), {
      type: 'CROSS_OFF',
      player: 'player1',
      pokemonId: 3,
      eliminated: true,
    });
    const uncrossed = reduce(crossed, {
      type: 'CROSS_OFF',
      player: 'player1',
      pokemonId: 3,
      eliminated: false,
    });
    expect(uncrossed.eliminated.player1).not.toContain(3);
  });

  test('crossing off is NOT turn-gated — a player may mark during their opponent’s turn', () => {
    // It is player1's turn to ask; player2 crosses off anyway.
    const next = reduce(playingMatch('player1'), {
      type: 'CROSS_OFF',
      player: 'player2',
      pokemonId: 5,
      eliminated: true,
    });
    expect(next.eliminated.player2).toContain(5);
  });

  test('crossing off is un-gated by phase — it works while an answer is pending', () => {
    const afterAsk = reduce(playingMatch('player1'), {
      type: 'ASK',
      player: 'player1',
      question: 'Fire?',
    });
    const next = reduce(afterAsk, {
      type: 'CROSS_OFF',
      player: 'player1',
      pokemonId: 5,
      eliminated: true,
    });
    expect(next.eliminated.player1).toContain(5);
    // The turn loop is untouched by a private mark.
    expect(next.phase).toBe('awaiting_answer');
    expect(next.currentPlayer).toBe('player1');
  });

  test('a mark never mutates the opponent’s visible state', () => {
    const start = playingMatch('player1', { eliminated: { player1: [], player2: [9] } });
    const next = reduce(start, {
      type: 'CROSS_OFF',
      player: 'player1',
      pokemonId: 3,
      eliminated: true,
    });
    // Opponent's list is unchanged and not the same array reference we can mutate.
    expect(next.eliminated.player2).toEqual([9]);
    expect(start.eliminated.player1).toEqual([]); // input not mutated
  });

  test('crossing off a card that is not on the board is rejected', () => {
    expect(() =>
      reduce(playingMatch('player1'), {
        type: 'CROSS_OFF',
        player: 'player1',
        pokemonId: 999,
        eliminated: true,
      }),
    ).toThrow(/not on the board/i);
  });
});

describe('game reducer skeleton — events not yet implemented', () => {
  const events: MatchEvent[] = [
    { type: 'GUESS', player: 'player1', pokemonId: 6 },
    { type: 'RESIGN', player: 'player2' },
    { type: 'CLAIM_INACTIVE', player: 'player1' },
  ];

  test.each(events)('$type is a recognised event with no logic yet', (event) => {
    expect(() => reduce(activeMatch(), event)).toThrow(`${event.type} not implemented yet`);
  });
});
