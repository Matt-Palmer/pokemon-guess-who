/**
 * Pure gating for the guess reveal (issue 14, PRD 44).
 *
 * The reveal sequence is pure theater over an already-written end state, so
 * the rules for *when* it plays and *which* secret turns over live here, out
 * of the component tree, where they're unit-testable:
 *
 * - It plays only on the observed `active → completed` edge with
 *   `ended_reason = 'guess'`. A screen mounted onto an already-finished match
 *   (returning from the home list, cold start from a push) goes straight to
 *   the end screen — the moment has passed. Resigns and inactivity claims get
 *   no theatrics: nothing was deduced.
 * - The card that turns over is the secret the guess resolved: the loser's.
 *   The winner watches the opponent's secret confirmed; the loser watches
 *   their own secret found out.
 */

export type RevealableMatch = {
  status: 'lobby' | 'active' | 'completed' | 'abandoned';
  ended_reason: 'guess' | 'resign' | 'claim_inactive' | null;
  winner_id: string | null;
  player1_id: string;
};

export type RevealableResult = {
  player1Secret: number;
  player2Secret: number;
};

/** True only on the live edge into a guess-completed match. */
export function shouldPlayGuessReveal(
  prevStatus: RevealableMatch['status'] | undefined,
  match: RevealableMatch | null,
): boolean {
  return (
    prevStatus === 'active' && match?.status === 'completed' && match.ended_reason === 'guess'
  );
}

/** The pokemon id the reveal turns over: the loser's secret. */
export function guessedSecretId(
  match: RevealableMatch,
  result: RevealableResult | null,
): number | null {
  if (!result || !match.winner_id) return null;
  return match.winner_id === match.player1_id ? result.player2Secret : result.player1Secret;
}
