export type GameOutcome = 'win' | 'loss';

export type PlayerStats = {
  gamesPlayed: number;
  wins: number;
  losses: number;
  currentStreak: number;
  bestStreak: number;
};

export const EMPTY_STATS: PlayerStats = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  currentStreak: 0,
  bestStreak: 0,
};

/**
 * The stat delta a single game-end applies to one player's record. This is the
 * single source of truth for the rule the DB trigger mirrors: a win increments
 * the current streak (and may extend the best streak); a loss resets the
 * current streak to zero. Best streak never decreases. Pure/deterministic —
 * like the match reducer, so streak arithmetic is exhaustively testable with
 * no network.
 */
export function applyGameEnd(stats: PlayerStats, outcome: GameOutcome): PlayerStats {
  if (outcome === 'win') {
    const currentStreak = stats.currentStreak + 1;
    return {
      ...stats,
      gamesPlayed: stats.gamesPlayed + 1,
      wins: stats.wins + 1,
      currentStreak,
      bestStreak: Math.max(stats.bestStreak, currentStreak),
    };
  }
  return {
    ...stats,
    gamesPlayed: stats.gamesPlayed + 1,
    losses: stats.losses + 1,
    currentStreak: 0,
  };
}

/** Win rate as a whole percentage, derived — never stored. 0 before any game. */
export function winRatePercent(wins: number, gamesPlayed: number): number {
  return gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
}
