/**
 * Pure whose-turn derivation for the active-games list (issue 08).
 *
 * Given a match row and the viewing player's id, says whether the game is
 * waiting on them and which state it's in. The UI maps `kind` to copy (it
 * holds the opponent's name); the derivation itself never needs names, so it
 * stays a pure function of the match row and is unit-testable in isolation.
 */

export type TurnKind =
  | 'waiting_for_opponent' // lobby host, seat still open
  | 'ready_to_start' // lobby host, opponent seated — your move is to start
  | 'waiting_for_host' // lobby joiner
  | 'your_draw'
  | 'their_draw'
  | 'your_question' // your turn: ask or guess
  | 'their_question'
  | 'your_answer'
  | 'their_answer'
  | 'finished';

export type TurnSummary = { myMove: boolean; kind: TurnKind };

export type SummarizableMatch = {
  status: 'lobby' | 'active' | 'completed' | 'abandoned';
  player1_id: string;
  player2_id: string | null;
  player1_drawn: boolean;
  player2_drawn: boolean;
  current_player: 'player1' | 'player2' | null;
  phase: 'awaiting_question' | 'awaiting_answer' | null;
};

export function summarizeTurn(match: SummarizableMatch, myId: string): TurnSummary {
  const mySlot = match.player1_id === myId ? 'player1' : 'player2';

  if (match.status === 'completed' || match.status === 'abandoned') {
    return { myMove: false, kind: 'finished' };
  }

  if (match.status === 'lobby') {
    if (mySlot !== 'player1') return { myMove: false, kind: 'waiting_for_host' };
    return match.player2_id
      ? { myMove: true, kind: 'ready_to_start' }
      : { myMove: false, kind: 'waiting_for_opponent' };
  }

  // Active. Blind draw first: player 1 draws, then player 2.
  if (!match.player1_drawn || !match.player2_drawn) {
    const drawSlot = match.player1_drawn ? 'player2' : 'player1';
    return drawSlot === mySlot
      ? { myMove: true, kind: 'your_draw' }
      : { myMove: false, kind: 'their_draw' };
  }

  // Turn loop. The answerer is the opponent of the asker (current_player).
  if (match.phase === 'awaiting_answer') {
    return match.current_player !== mySlot
      ? { myMove: true, kind: 'your_answer' }
      : { myMove: false, kind: 'their_answer' };
  }

  return match.current_player === mySlot
    ? { myMove: true, kind: 'your_question' }
    : { myMove: false, kind: 'their_question' };
}
