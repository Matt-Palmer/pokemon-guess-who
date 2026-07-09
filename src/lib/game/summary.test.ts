import { summarizeTurn, SummarizableMatch } from './summary';

const P1 = 'user_p1';
const P2 = 'user_p2';

function match(overrides: Partial<SummarizableMatch> = {}): SummarizableMatch {
  return {
    status: 'active',
    player1_id: P1,
    player2_id: P2,
    player1_drawn: true,
    player2_drawn: true,
    current_player: 'player1',
    phase: 'awaiting_question',
    ...overrides,
  };
}

describe('summarizeTurn', () => {
  describe('lobby', () => {
    const openLobby = match({ status: 'lobby', player2_id: null, player1_drawn: false, player2_drawn: false, current_player: null, phase: null });
    const fullLobby = match({ status: 'lobby', player1_drawn: false, player2_drawn: false, current_player: null, phase: null });

    it('host with an open seat is waiting, not on the move', () => {
      expect(summarizeTurn(openLobby, P1)).toEqual({ myMove: false, kind: 'waiting_for_opponent' });
    });

    it('host with a seated opponent is on the move to start', () => {
      expect(summarizeTurn(fullLobby, P1)).toEqual({ myMove: true, kind: 'ready_to_start' });
    });

    it('joiner waits for the host to start', () => {
      expect(summarizeTurn(fullLobby, P2)).toEqual({ myMove: false, kind: 'waiting_for_host' });
    });
  });

  describe('blind draw', () => {
    const noneDrawn = match({ player1_drawn: false, player2_drawn: false, current_player: null, phase: null });
    const p1Drawn = match({ player1_drawn: true, player2_drawn: false, current_player: null, phase: null });

    it('player 1 draws first', () => {
      expect(summarizeTurn(noneDrawn, P1)).toEqual({ myMove: true, kind: 'your_draw' });
      expect(summarizeTurn(noneDrawn, P2)).toEqual({ myMove: false, kind: 'their_draw' });
    });

    it('player 2 draws once player 1 has drawn', () => {
      expect(summarizeTurn(p1Drawn, P2)).toEqual({ myMove: true, kind: 'your_draw' });
      expect(summarizeTurn(p1Drawn, P1)).toEqual({ myMove: false, kind: 'their_draw' });
    });
  });

  describe('turn loop', () => {
    it('awaiting_question puts the move on current_player', () => {
      const m = match({ current_player: 'player2', phase: 'awaiting_question' });
      expect(summarizeTurn(m, P2)).toEqual({ myMove: true, kind: 'your_question' });
      expect(summarizeTurn(m, P1)).toEqual({ myMove: false, kind: 'their_question' });
    });

    it("awaiting_answer puts the move on the asker's opponent", () => {
      const m = match({ current_player: 'player1', phase: 'awaiting_answer' });
      expect(summarizeTurn(m, P2)).toEqual({ myMove: true, kind: 'your_answer' });
      expect(summarizeTurn(m, P1)).toEqual({ myMove: false, kind: 'their_answer' });
    });
  });

  describe('finished games', () => {
    it.each(['completed', 'abandoned'] as const)('%s is never anyone\'s move', (status) => {
      const m = match({ status });
      expect(summarizeTurn(m, P1)).toEqual({ myMove: false, kind: 'finished' });
      expect(summarizeTurn(m, P2)).toEqual({ myMove: false, kind: 'finished' });
    });
  });
});
