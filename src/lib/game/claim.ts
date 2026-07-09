/**
 * Pure derivation for the 7-day inactivity claim UI (issue 10).
 *
 * Whether the viewing player is currently waiting on their opponent, and if
 * so how long until — or that — they may claim the win. Time is an input
 * (`nowMs`), so the derivation is deterministic and the countdown is a pure
 * function of the match row the client already holds: the window runs from
 * `last_activity_at`, which every gameplay RPC bumps (the server-only
 * `claim_notified` flag never reaches clients and plays no part here).
 */

import { CLAIM_WINDOW_MS } from './reducer';
import { SummarizableMatch, summarizeTurn } from './summary';

export type ClaimState =
  /** Not an active match, or the move is yours — there is nothing to claim. */
  | { kind: 'not_applicable' }
  /** Waiting on the opponent; the claim unlocks in `remainingMs`. */
  | { kind: 'countdown'; remainingMs: number }
  /** The opponent has been idle 7+ days — the win can be claimed now. */
  | { kind: 'claimable' };

export function claimState(
  match: SummarizableMatch & { last_activity_at: string },
  myId: string,
  nowMs: number,
): ClaimState {
  if (match.status !== 'active') return { kind: 'not_applicable' };
  // summarizeTurn is draw-order aware and knows the answerer holds the move
  // during awaiting_answer — when the move is mine, *I* am the potential
  // staller and no claim exists for me.
  if (summarizeTurn(match, myId).myMove) return { kind: 'not_applicable' };

  const remainingMs = Date.parse(match.last_activity_at) + CLAIM_WINDOW_MS - nowMs;
  return remainingMs > 0 ? { kind: 'countdown', remainingMs } : { kind: 'claimable' };
}

/**
 * A coarse human-readable duration for the claim countdown: the two largest
 * relevant units ("6d 23h", "5h 12m", "42m"), never seconds — the window is
 * seven days, so minute precision is plenty and the UI only re-renders on a
 * slow tick.
 */
export function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
