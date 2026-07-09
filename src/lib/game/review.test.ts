import { pairThread, splitByMarks, ThreadEvent } from './review';

function q(id: string, body: string, slot: 'player1' | 'player2' = 'player1'): ThreadEvent {
  return { id, kind: 'question', author_slot: slot, body };
}

function a(id: string, body: string, slot: 'player1' | 'player2' = 'player2'): ThreadEvent {
  return { id, kind: 'answer', author_slot: slot, body };
}

describe('pairThread', () => {
  it('returns no entries for an empty thread', () => {
    expect(pairThread([])).toEqual([]);
  });

  it('pairs each question with the answer that follows it, in thread order', () => {
    const entries = pairThread([
      q('e1', 'Is it a fire type?'),
      a('e2', 'No'),
      q('e3', 'Is it a water type?', 'player2'),
      a('e4', 'Yes', 'player1'),
    ]);
    expect(entries).toEqual([
      { question: q('e1', 'Is it a fire type?'), answer: a('e2', 'No') },
      { question: q('e3', 'Is it a water type?', 'player2'), answer: a('e4', 'Yes', 'player1') },
    ]);
  });

  it('leaves a pending question with a null answer', () => {
    const entries = pairThread([q('e1', 'Is it round?'), a('e2', 'Yes'), q('e3', 'Is it blue?')]);
    expect(entries[1]).toEqual({ question: q('e3', 'Is it blue?'), answer: null });
  });

  it('attaches an answer to the most recent unanswered question', () => {
    // Not producible under the phase gating (one open question at a time), but
    // the pairing must not mis-attribute answers if it ever happens.
    const entries = pairThread([q('e1', 'First?'), q('e2', 'Second?'), a('e3', 'Yes')]);
    expect(entries).toEqual([
      { question: q('e1', 'First?'), answer: null },
      { question: q('e2', 'Second?'), answer: a('e3', 'Yes') },
    ]);
  });

  it('drops an answer with no open question rather than inventing an entry', () => {
    const entries = pairThread([a('e1', 'Yes'), q('e2', 'Real question?'), a('e3', 'No')]);
    expect(entries).toEqual([{ question: q('e2', 'Real question?'), answer: a('e3', 'No') }]);
  });
});

describe('splitByMarks', () => {
  const cards = [{ id: 1 }, { id: 25 }, { id: 7 }, { id: 133 }];

  it('splits crossed-off from remaining, both preserving board order', () => {
    const { crossedOff, remaining } = splitByMarks(cards, new Set([133, 1]));
    expect(crossedOff).toEqual([{ id: 1 }, { id: 133 }]);
    expect(remaining).toEqual([{ id: 25 }, { id: 7 }]);
  });

  it('reports every card remaining when nothing is crossed off', () => {
    const { crossedOff, remaining } = splitByMarks(cards, new Set());
    expect(crossedOff).toEqual([]);
    expect(remaining).toEqual(cards);
  });

  it('ignores marks for ids that are not on the board', () => {
    const { crossedOff, remaining } = splitByMarks(cards, new Set([9999]));
    expect(crossedOff).toEqual([]);
    expect(remaining).toEqual(cards);
  });

  it('accounts for every board card exactly once', () => {
    const { crossedOff, remaining } = splitByMarks(cards, new Set([25, 7]));
    expect(crossedOff.length + remaining.length).toBe(cards.length);
    expect(new Set([...crossedOff, ...remaining].map((c) => c.id)).size).toBe(cards.length);
  });
});
