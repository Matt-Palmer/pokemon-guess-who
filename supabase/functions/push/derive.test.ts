import {
  deriveNotifications,
  MatchWebhookRow,
  toExpoMessages,
} from './derive';

/**
 * The Edge Function's recipient/payload selection, exercised as row
 * transitions — each test is a real game moment (join, draw, ask, answer,
 * wrong/right guess, claim) asserting who gets notified and with what.
 */

const P1 = 'user_host';
const P2 = 'user_joiner';
const NAMES = { [P1]: 'Ash', [P2]: 'Misty' };

function row(overrides: Partial<MatchWebhookRow> = {}): MatchWebhookRow {
  return {
    id: 'match-1',
    status: 'active',
    player1_id: P1,
    player2_id: P2,
    player1_drawn: true,
    player2_drawn: true,
    current_player: 'player1',
    phase: 'awaiting_question',
    winner_id: null,
    ended_reason: null,
    claim_notified: false,
    ...overrides,
  };
}

describe('deriveNotifications', () => {
  it('notifies the host when someone joins their party', () => {
    const before = row({ status: 'lobby', player2_id: null, player1_drawn: false, player2_drawn: false, current_player: null, phase: null });
    const after = { ...before, player2_id: P2 };

    const messages = deriveNotifications(before, after, NAMES);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: 'party_joined',
      recipientId: P1,
      url: '/lobby/match-1',
    });
    expect(messages[0].title).toContain('Misty');
  });

  it('notifies player2 to draw once player1 has drawn', () => {
    const before = row({ player1_drawn: false, player2_drawn: false, current_player: null, phase: null });
    const after = { ...before, player1_drawn: true };

    const messages = deriveNotifications(before, after, NAMES);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: 'your_turn',
      recipientId: P2,
      url: '/match/match-1',
    });
    expect(messages[0].body).toContain('Ash');
  });

  it('notifies the coin-flipped first player when the draw completes', () => {
    const before = row({ player2_drawn: false, current_player: null, phase: null });

    for (const first of ['player1', 'player2'] as const) {
      const after = row({ current_player: first });
      const messages = deriveNotifications(before, after, NAMES);

      expect(messages).toHaveLength(1);
      expect(messages[0].kind).toBe('your_turn');
      expect(messages[0].recipientId).toBe(first === 'player1' ? P1 : P2);
      expect(messages[0].body).toContain('go first');
    }
  });

  it("notifies the asker's opponent when a question needs answering", () => {
    const before = row({ current_player: 'player2' });
    const after = row({ current_player: 'player2', phase: 'awaiting_answer' });

    const messages = deriveNotifications(before, after, NAMES);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: 'answer_needed',
      recipientId: P1,
      url: '/match/match-1',
    });
    expect(messages[0].body).toContain('Misty');
  });

  it('does not notify an answerer about the turn their own answer created', () => {
    // Player2 answers player1's question: turn passes to player2 (the actor).
    const before = row({ current_player: 'player1', phase: 'awaiting_answer' });
    const after = row({ current_player: 'player2', phase: 'awaiting_question' });

    expect(deriveNotifications(before, after, NAMES)).toEqual([]);
  });

  it('notifies the new current player when a turn passes, without revealing the wrong guess', () => {
    // A wrong guess passes the turn while the phase stays awaiting_question.
    const before = row({ current_player: 'player1' });
    const after = row({ current_player: 'player2' });

    const messages = deriveNotifications(before, after, NAMES);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: 'your_turn', recipientId: P2 });
    // Guesses are private: the copy must not hint one happened.
    expect(messages[0].body.toLowerCase()).not.toContain('guessed');
    expect(messages[0].body.toLowerCase()).not.toContain('wrong');
  });

  it('notifies both players with win/loss copy when the game ends', () => {
    const before = row({ current_player: 'player2' });
    const after = row({
      status: 'completed',
      winner_id: P2,
      current_player: 'player2',
    });

    const messages = deriveNotifications(before, after, NAMES);

    expect(messages).toHaveLength(2);
    const toWinner = messages.find((m) => m.recipientId === P2)!;
    const toLoser = messages.find((m) => m.recipientId === P1)!;
    expect(toWinner).toMatchObject({ kind: 'game_ended', title: 'You won! 🎉' });
    expect(toLoser.kind).toBe('game_ended');
    expect(toLoser.body).toContain('Misty');
    expect(toLoser.url).toBe('/match/match-1');
  });

  it('phrases the game-ended copy as a resignation when the loser resigned', () => {
    const before = row({ current_player: 'player2' });
    const after = row({ status: 'completed', winner_id: P2, ended_reason: 'resign' });

    const messages = deriveNotifications(before, after, NAMES);

    expect(messages).toHaveLength(2);
    const toWinner = messages.find((m) => m.recipientId === P2)!;
    const toLoser = messages.find((m) => m.recipientId === P1)!;
    expect(toWinner.body).toContain('Ash resigned');
    expect(toLoser.body).toContain('You resigned');
  });

  it('phrases the game-ended copy as a claim when the win was claimed', () => {
    const before = row({ current_player: 'player1' });
    const after = row({ status: 'completed', winner_id: P2, ended_reason: 'claim_inactive' });

    const messages = deriveNotifications(before, after, NAMES);

    expect(messages).toHaveLength(2);
    const toWinner = messages.find((m) => m.recipientId === P2)!;
    const toLoser = messages.find((m) => m.recipientId === P1)!;
    expect(toWinner.body).toContain('You claimed');
    expect(toLoser.body).toContain('Misty claimed the win');
  });

  it('sends nothing for a completion without a winner (abandoned path)', () => {
    const before = row();
    const after = row({ status: 'completed', winner_id: null });

    expect(deriveNotifications(before, after, NAMES)).toEqual([]);
  });

  it('notifies the waiting player when a claim becomes available', () => {
    // Player1 must ask and has stalled → player2 can claim.
    const stalledAsker = deriveNotifications(
      row(),
      row({ claim_notified: true }),
      NAMES,
    );
    expect(stalledAsker).toHaveLength(1);
    expect(stalledAsker[0]).toMatchObject({ kind: 'claim_available', recipientId: P2 });
    expect(stalledAsker[0].body).toContain('Ash');

    // Player1 asked, player2 must answer and has stalled → player1 can claim.
    const stalledAnswerer = deriveNotifications(
      row({ phase: 'awaiting_answer' }),
      row({ phase: 'awaiting_answer', claim_notified: true }),
      NAMES,
    );
    expect(stalledAnswerer).toHaveLength(1);
    expect(stalledAnswerer[0]).toMatchObject({ kind: 'claim_available', recipientId: P1 });

    // Player2 never drew → player1 can claim.
    const stalledDrawer = deriveNotifications(
      row({ player2_drawn: false, current_player: null, phase: null }),
      row({ player2_drawn: false, current_player: null, phase: null, claim_notified: true }),
      NAMES,
    );
    expect(stalledDrawer).toHaveLength(1);
    expect(stalledDrawer[0]).toMatchObject({ kind: 'claim_available', recipientId: P1 });
  });

  it('sends nothing when no notified transition occurred (chat stays silent)', () => {
    // Chat/Q&A inserts land in match_events — the matches row is untouched
    // except for activity bumps, which must never ping anyone.
    expect(deriveNotifications(row(), row(), NAMES)).toEqual([]);

    // Lobby → active (host pressed Start; the host draws first) is also silent.
    const lobby = row({ status: 'lobby', player1_drawn: false, player2_drawn: false, current_player: null, phase: null });
    const started = { ...lobby, status: 'active' as const };
    expect(deriveNotifications(lobby, started, NAMES)).toEqual([]);
  });

  it('falls back to generic copy when a username is missing', () => {
    const before = row({ current_player: 'player2' });
    const after = row({ current_player: 'player2', phase: 'awaiting_answer' });

    const messages = deriveNotifications(before, after, {});

    expect(messages[0].body).toContain('Your opponent');
  });
});

describe('toExpoMessages', () => {
  const message = {
    kind: 'your_turn' as const,
    recipientId: P1,
    title: 'Your move',
    body: 'body',
    url: '/match/match-1',
  };

  it("attaches the recipient's token and the tap-through url", () => {
    const expo = toExpoMessages([message], { [P1]: 'ExponentPushToken[abc]' });

    expect(expo).toEqual([
      {
        to: 'ExponentPushToken[abc]',
        sound: 'default',
        title: 'Your move',
        body: 'body',
        data: { url: '/match/match-1', kind: 'your_turn' },
      },
    ]);
  });

  it('drops recipients with no stored token', () => {
    expect(toExpoMessages([message], {})).toEqual([]);
    expect(toExpoMessages([message], { [P1]: null })).toEqual([]);
    expect(toExpoMessages([message], { [P2]: 'ExponentPushToken[xyz]' })).toEqual([]);
  });
});
