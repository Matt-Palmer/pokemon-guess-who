/**
 * Shared motion vocabulary (issue 14). One place for the timings screens and
 * components agree on, so the game's rhythm stays consistent.
 *
 * House rules for motion (see issues/14-motion.md):
 * - Animations are presentation over already-correct state — they never gate
 *   or reorder game writes, and interrupting one must leave state correct.
 * - Everything honors reduced motion: Reanimated skips entering/layout
 *   animations by itself; custom sequences check `useReducedMotion()` and
 *   jump to their final state.
 */
export const motion = {
  /** One face-to-face card flip (cross-off, reveals). */
  flip: 350,
  /** Per-tile stagger when the board deals in (24 tiles ≈ 0.8s wave). */
  dealStagger: 35,
  /** A short beat of anticipation before a dramatic turn-over. */
  pause: 900,
  /** How long the win/loss payoff holds before the end screen takes over. */
  payoffHold: 2600,
} as const;

/** Deal-in delay for the tile at board `index` (row-major wave). */
export const dealDelay = (index: number) => index * motion.dealStagger;
