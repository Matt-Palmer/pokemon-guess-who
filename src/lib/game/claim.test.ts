import { claimState, formatRemaining } from './claim';
import { CLAIM_WINDOW_MS } from './reducer';
import { SummarizableMatch } from './summary';

const P1 = 'user_1';
const P2 = 'user_2';
const stalledAt = '2026-07-01T12:00:00.000Z';
const stalledAtMs = Date.parse(stalledAt);

/** An active match mid-turn-loop where `current` must ask, idle since `stalledAt`. */
function match(overrides: Partial<SummarizableMatch> = {}): SummarizableMatch & { last_activity_at: string } {
  return {
    status: 'active',
    player1_id: P1,
    player2_id: P2,
    player1_drawn: true,
    player2_drawn: true,
    current_player: 'player1',
    phase: 'awaiting_question',
    last_activity_at: stalledAt,
    ...overrides,
  };
}

describe('claimState', () => {
  test('counts down while waiting on the opponent, then becomes claimable at 7 days', () => {
    // player1 must ask; player2 is the waiting player.
    const oneDayIn = claimState(match(), P2, stalledAtMs + 24 * 60 * 60 * 1000);
    expect(oneDayIn).toEqual({ kind: 'countdown', remainingMs: CLAIM_WINDOW_MS - 24 * 60 * 60 * 1000 });

    expect(claimState(match(), P2, stalledAtMs + CLAIM_WINDOW_MS)).toEqual({ kind: 'claimable' });
    expect(claimState(match(), P2, stalledAtMs + CLAIM_WINDOW_MS + 1)).toEqual({ kind: 'claimable' });
  });

  test('never applies to the player who holds the move', () => {
    expect(claimState(match(), P1, stalledAtMs + CLAIM_WINDOW_MS * 2)).toEqual({
      kind: 'not_applicable',
    });
  });

  test('during awaiting_answer the asker is the one who can claim', () => {
    // player1 asked; player2 must answer and is the staller.
    const m = match({ phase: 'awaiting_answer' });
    expect(claimState(m, P1, stalledAtMs + CLAIM_WINDOW_MS)).toEqual({ kind: 'claimable' });
    expect(claimState(m, P2, stalledAtMs + CLAIM_WINDOW_MS)).toEqual({ kind: 'not_applicable' });
  });

  test('applies during the blind draw against a never-drawing opponent', () => {
    const m = match({ player2_drawn: false, current_player: null, phase: null });
    expect(claimState(m, P1, stalledAtMs + 1000)).toMatchObject({ kind: 'countdown' });
    expect(claimState(m, P1, stalledAtMs + CLAIM_WINDOW_MS)).toEqual({ kind: 'claimable' });
    expect(claimState(m, P2, stalledAtMs + CLAIM_WINDOW_MS)).toEqual({ kind: 'not_applicable' });
  });

  test('only active matches can be claimed — lobbies and finished games never apply', () => {
    for (const status of ['lobby', 'completed', 'abandoned'] as const) {
      expect(claimState(match({ status }), P2, stalledAtMs + CLAIM_WINDOW_MS)).toEqual({
        kind: 'not_applicable',
      });
    }
  });
});

describe('formatRemaining', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  test('renders the two largest relevant units', () => {
    expect(formatRemaining(6 * DAY + 23 * HOUR)).toBe('6d 23h');
    expect(formatRemaining(5 * HOUR + 12 * MIN)).toBe('5h 12m');
    expect(formatRemaining(42 * MIN)).toBe('42m');
  });

  test('rounds up so the countdown never reads zero while time remains', () => {
    expect(formatRemaining(30_000)).toBe('1m');
    expect(formatRemaining(500)).toBe('1m');
    // A freshly-moved 7-day window reads as full.
    expect(formatRemaining(CLAIM_WINDOW_MS)).toBe('7d 0h');
  });
});
