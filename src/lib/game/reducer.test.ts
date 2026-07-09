import { reduce } from './reducer';
import { MatchState } from './types';

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
    endedReason: null,
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

describe('GUESS — ending the game', () => {
  // player1's secret is 7, player2's is 12 (see playingMatch). player1 guesses
  // player2's card, so a correct guess is 12 and any other board card is wrong.
  test('a correct guess wins the match for the guesser and ends it', () => {
    const next = reduce(playingMatch('player1'), { type: 'GUESS', player: 'player1', pokemonId: 12 });
    expect(next.status).toBe('completed');
    expect(next.winnerId).toBe('user_1'); // player1Id
    expect(next.endedAt).not.toBeNull();
  });

  test('player2 guessing player1’s secret wins for player2', () => {
    // Move the turn to player2 first (player1 asks, player2 answers).
    let s = reduce(playingMatch('player1'), { type: 'ASK', player: 'player1', question: 'Fire?' });
    s = reduce(s, { type: 'ANSWER', player: 'player2', answer: 'No' });
    const next = reduce(s, { type: 'GUESS', player: 'player2', pokemonId: 7 });
    expect(next.status).toBe('completed');
    expect(next.winnerId).toBe('user_2'); // player2Id
  });

  test('a wrong guess auto-crosses the missed card on the guesser’s own board and passes the turn', () => {
    const next = reduce(playingMatch('player1'), { type: 'GUESS', player: 'player1', pokemonId: 5 });
    expect(next.status).toBe('active');
    expect(next.winnerId).toBeNull();
    expect(next.eliminated.player1).toContain(5);
    // Turn passes to the opponent, back to the question phase.
    expect(next.currentPlayer).toBe('player2');
    expect(next.phase).toBe('awaiting_question');
  });

  test('a wrong guess never touches the opponent’s state — the guess stays private', () => {
    const start = playingMatch('player1', { eliminated: { player1: [], player2: [9] } });
    const next = reduce(start, { type: 'GUESS', player: 'player1', pokemonId: 5 });
    // The opponent's crossed-off list is untouched; nothing reveals the guess.
    expect(next.eliminated.player2).toEqual([9]);
    expect(start.eliminated.player1).toEqual([]); // input not mutated
  });

  test('a player cannot guess when it is not their turn', () => {
    expect(() =>
      reduce(playingMatch('player1'), { type: 'GUESS', player: 'player2', pokemonId: 7 }),
    ).toThrow(/not your turn/i);
  });

  test('a player cannot both ask and guess in the same turn — no guess while an answer is pending', () => {
    const afterAsk = reduce(playingMatch('player1'), {
      type: 'ASK',
      player: 'player1',
      question: 'Fire?',
    });
    expect(() =>
      reduce(afterAsk, { type: 'GUESS', player: 'player1', pokemonId: 12 }),
    ).toThrow(/turn|awaiting/i);
  });

  test('a card must be on the board to be guessed', () => {
    expect(() =>
      reduce(playingMatch('player1'), { type: 'GUESS', player: 'player1', pokemonId: 999 }),
    ).toThrow(/not on the board/i);
  });

  test('guesses can only be made during an active match', () => {
    expect(() =>
      reduce(playingMatch('player1', { status: 'completed' }), {
        type: 'GUESS',
        player: 'player1',
        pokemonId: 12,
      }),
    ).toThrow(/active/i);
  });
});

describe('RESIGN — immediate forfeit', () => {
  test('resigning forfeits: the opponent wins and the match ends', () => {
    const next = reduce(playingMatch('player1'), { type: 'RESIGN', player: 'player1' });
    expect(next.status).toBe('completed');
    expect(next.winnerId).toBe('user_2');
    expect(next.endedReason).toBe('resign');
    expect(next.endedAt).not.toBeNull();
  });

  test('either player may resign — player 2 forfeits to player 1', () => {
    const next = reduce(playingMatch('player1'), { type: 'RESIGN', player: 'player2' });
    expect(next.winnerId).toBe('user_1');
  });

  test('resigning is not turn-gated — the waiting player can walk away', () => {
    // player1's turn to ask; player2 resigns anyway.
    const next = reduce(playingMatch('player1'), { type: 'RESIGN', player: 'player2' });
    expect(next.status).toBe('completed');
    expect(next.winnerId).toBe('user_1');
  });

  test('a match can be resigned during the blind draw', () => {
    const next = reduce(activeMatch(), { type: 'RESIGN', player: 'player1' });
    expect(next.status).toBe('completed');
    expect(next.winnerId).toBe('user_2');
  });

  test('only an active match can be resigned — a finished game is immutable', () => {
    expect(() =>
      reduce(playingMatch('player1', { status: 'completed' }), { type: 'RESIGN', player: 'player1' }),
    ).toThrow(/active/i);
  });

  test('a lobby cannot be resigned', () => {
    expect(() =>
      reduce(activeMatch({ status: 'lobby' }), { type: 'RESIGN', player: 'player1' }),
    ).toThrow(/active/i);
  });
});

describe('CLAIM_INACTIVE — 7-day inactivity claim', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const stalledAt = '2026-07-01T12:00:00.000Z';
  const after = (days: number) => new Date(Date.parse(stalledAt) + days * DAY_MS).toISOString();

  test('the waiting player claims the win once the opponent is 7 days idle', () => {
    // player2's turn to ask and they've gone quiet; player1 claims.
    const state = playingMatch('player2', { lastActivityAt: stalledAt });
    const next = reduce(state, { type: 'CLAIM_INACTIVE', player: 'player1', now: after(7) });
    expect(next.status).toBe('completed');
    expect(next.winnerId).toBe('user_1');
    expect(next.endedReason).toBe('claim_inactive');
    expect(next.endedAt).toBe(after(7));
  });

  test('the claim counts as the no-show’s loss whichever seat is waiting', () => {
    const state = playingMatch('player1', { lastActivityAt: stalledAt });
    const next = reduce(state, { type: 'CLAIM_INACTIVE', player: 'player2', now: after(8) });
    expect(next.winnerId).toBe('user_2');
  });

  test('a claim before 7 days is rejected — the opponent still has time', () => {
    const state = playingMatch('player2', { lastActivityAt: stalledAt });
    expect(() =>
      reduce(state, { type: 'CLAIM_INACTIVE', player: 'player1', now: after(6.99) }),
    ).toThrow(/still has time/i);
  });

  test('you cannot claim while the move is yours — only a stalled opponent forfeits', () => {
    const state = playingMatch('player1', { lastActivityAt: stalledAt });
    expect(() =>
      reduce(state, { type: 'CLAIM_INACTIVE', player: 'player1', now: after(10) }),
    ).toThrow(/waiting on your opponent/i);
  });

  test('during awaiting_answer the stalled player is the answerer, not the asker', () => {
    // player1 asked and is waiting on player2's answer: player1 may claim…
    const state = playingMatch('player1', { phase: 'awaiting_answer', lastActivityAt: stalledAt });
    const next = reduce(state, { type: 'CLAIM_INACTIVE', player: 'player1', now: after(7) });
    expect(next.winnerId).toBe('user_1');
    // …and player2 (the one stalling) may not.
    expect(() =>
      reduce(state, { type: 'CLAIM_INACTIVE', player: 'player2', now: after(7) }),
    ).toThrow(/waiting on your opponent/i);
  });

  test('a never-drawn opponent can be claimed against during the blind draw', () => {
    // player1 drew; player2 never has. player1 waits out the window and claims.
    const state = activeMatch({ player1Secret: 7, lastActivityAt: stalledAt });
    const next = reduce(state, { type: 'CLAIM_INACTIVE', player: 'player1', now: after(7) });
    expect(next.winnerId).toBe('user_1');
  });

  test('only an active match can be claimed', () => {
    const state = playingMatch('player2', { status: 'completed', lastActivityAt: stalledAt });
    expect(() =>
      reduce(state, { type: 'CLAIM_INACTIVE', player: 'player1', now: after(10) }),
    ).toThrow(/active/i);
  });
});
