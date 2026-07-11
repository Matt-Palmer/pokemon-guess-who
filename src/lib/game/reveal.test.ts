import { guessedSecretId, RevealableMatch, shouldPlayGuessReveal } from './reveal';

const P1 = 'user_p1';
const P2 = 'user_p2';

function match(overrides: Partial<RevealableMatch> = {}): RevealableMatch {
  return {
    status: 'completed',
    ended_reason: 'guess',
    winner_id: P1,
    player1_id: P1,
    ...overrides,
  };
}

describe('shouldPlayGuessReveal', () => {
  it('plays on the live active → completed edge of a guessed game', () => {
    expect(shouldPlayGuessReveal('active', match())).toBe(true);
  });

  it('does not play on a fresh mount of an already-completed match', () => {
    expect(shouldPlayGuessReveal(undefined, match())).toBe(false);
  });

  it('does not replay while the match stays completed', () => {
    expect(shouldPlayGuessReveal('completed', match())).toBe(false);
  });

  it('does not play while the match is still active', () => {
    expect(shouldPlayGuessReveal('active', match({ status: 'active' }))).toBe(false);
  });

  it('gives no theatrics to a resign', () => {
    expect(shouldPlayGuessReveal('active', match({ ended_reason: 'resign' }))).toBe(false);
  });

  it('gives no theatrics to an inactivity claim', () => {
    expect(shouldPlayGuessReveal('active', match({ ended_reason: 'claim_inactive' }))).toBe(false);
  });

  it('handles a match that has not loaded yet', () => {
    expect(shouldPlayGuessReveal('active', null)).toBe(false);
  });
});

describe('guessedSecretId', () => {
  const result = { player1Secret: 25, player2Secret: 143 };

  it("turns over player2's secret when player1 won", () => {
    expect(guessedSecretId(match({ winner_id: P1 }), result)).toBe(143);
  });

  it("turns over player1's secret when player2 won", () => {
    expect(guessedSecretId(match({ winner_id: P2 }), result)).toBe(25);
  });

  it('resolves nothing before the result has loaded', () => {
    expect(guessedSecretId(match(), null)).toBeNull();
  });

  it('resolves nothing without a winner', () => {
    expect(guessedSecretId(match({ winner_id: null }), result)).toBeNull();
  });
});
