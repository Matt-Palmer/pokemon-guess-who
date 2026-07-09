import { applyGameEnd, EMPTY_STATS, PlayerStats, winRatePercent } from './stats';

function stats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return { ...EMPTY_STATS, ...overrides };
}

describe('game-end stat deltas', () => {
  test('a win increments games played, wins, and the current streak', () => {
    const next = applyGameEnd(stats(), 'win');
    expect(next).toEqual({
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      currentStreak: 1,
      bestStreak: 1,
    });
  });

  test('a loss increments games played and losses, and resets the current streak', () => {
    const next = applyGameEnd(stats({ gamesPlayed: 5, wins: 3, losses: 2, currentStreak: 3, bestStreak: 3 }), 'loss');
    expect(next).toEqual({
      gamesPlayed: 6,
      wins: 3,
      losses: 3,
      currentStreak: 0,
      bestStreak: 3,
    });
  });

  test('consecutive wins grow the streak and the best streak tracks the max', () => {
    let s = stats();
    s = applyGameEnd(s, 'win');
    s = applyGameEnd(s, 'win');
    s = applyGameEnd(s, 'win');
    expect(s.currentStreak).toBe(3);
    expect(s.bestStreak).toBe(3);
  });

  test('a loss after a streak resets current but never the best streak', () => {
    let s = stats();
    s = applyGameEnd(s, 'win');
    s = applyGameEnd(s, 'win');
    s = applyGameEnd(s, 'loss');
    expect(s.currentStreak).toBe(0);
    expect(s.bestStreak).toBe(2);
  });

  test('a new streak must beat the old best before best moves again', () => {
    // best=3 from an earlier run; a fresh 2-win streak leaves best untouched…
    let s = stats({ gamesPlayed: 4, wins: 3, losses: 1, currentStreak: 0, bestStreak: 3 });
    s = applyGameEnd(s, 'win');
    s = applyGameEnd(s, 'win');
    expect(s.currentStreak).toBe(2);
    expect(s.bestStreak).toBe(3);
    // …until the 4th consecutive win overtakes it.
    s = applyGameEnd(s, 'win');
    s = applyGameEnd(s, 'win');
    expect(s.currentStreak).toBe(4);
    expect(s.bestStreak).toBe(4);
  });

  test('wins and losses always sum to games played', () => {
    const outcomes: ('win' | 'loss')[] = ['win', 'loss', 'loss', 'win', 'win', 'win', 'loss'];
    const final = outcomes.reduce(applyGameEnd, stats());
    expect(final.wins + final.losses).toBe(final.gamesPlayed);
    expect(final.gamesPlayed).toBe(outcomes.length);
  });

  test('applyGameEnd is pure — the input stats object is untouched', () => {
    const before = stats({ gamesPlayed: 2, wins: 1, losses: 1, currentStreak: 1, bestStreak: 1 });
    const snapshot = { ...before };
    applyGameEnd(before, 'win');
    applyGameEnd(before, 'loss');
    expect(before).toEqual(snapshot);
  });
});

describe('derived win rate', () => {
  test('is 0 before any game (no divide-by-zero)', () => {
    expect(winRatePercent(0, 0)).toBe(0);
  });

  test('is wins ÷ games played as a rounded percentage', () => {
    expect(winRatePercent(1, 2)).toBe(50);
    expect(winRatePercent(2, 3)).toBe(67);
    expect(winRatePercent(5, 5)).toBe(100);
  });
});
