/**
 * Pure derivations for the in-match review panel (issue 07).
 *
 * The panel shows the viewing player's own crossed-off cards and the match's
 * question/answer history. Both inputs are already private-by-construction on
 * the wire (`board_marks` RLS only exposes the caller's rows; `match_events`
 * is the shared thread both players see in-game), so these helpers are plain
 * data shaping — no filtering decisions that could leak opponent state.
 */

export type ThreadEvent = {
  id: string;
  kind: 'question' | 'answer';
  author_slot: 'player1' | 'player2';
  body: string;
};

/** One review entry: a question and the answer it received (null while pending). */
export type QAEntry<E extends ThreadEvent = ThreadEvent> = {
  question: E;
  answer: E | null;
};

/**
 * Groups an ordered event thread into question→answer pairs. An answer attaches
 * to the most recent unanswered question (the game's phase gating guarantees at
 * most one is ever open, but the pairing stays correct regardless). Answers with
 * no open question are dropped rather than invented into pairs.
 */
export function pairThread<E extends ThreadEvent>(events: E[]): QAEntry<E>[] {
  const entries: QAEntry<E>[] = [];
  for (const event of events) {
    if (event.kind === 'question') {
      entries.push({ question: event, answer: null });
      continue;
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].answer === null) {
        entries[i].answer = event;
        break;
      }
    }
  }
  return entries;
}

/**
 * Splits the board into crossed-off and remaining cards, both in board order.
 * Marks for ids not on the board (impossible via the RPC, but cheap to guard)
 * simply don't match anything.
 */
export function splitByMarks<C extends { id: number }>(
  cards: C[],
  marks: ReadonlySet<number>,
): { crossedOff: C[]; remaining: C[] } {
  const crossedOff: C[] = [];
  const remaining: C[] = [];
  for (const card of cards) {
    (marks.has(card.id) ? crossedOff : remaining).push(card);
  }
  return { crossedOff, remaining };
}
