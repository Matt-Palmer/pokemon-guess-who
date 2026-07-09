export type MatchStatus = 'lobby' | 'active' | 'completed' | 'abandoned';
export type Phase = 'awaiting_question' | 'awaiting_answer';
export type PlayerSlot = 'player1' | 'player2';
export type EndReason = 'guess' | 'resign' | 'claim_inactive';

export type MatchState = {
  id: string;
  status: MatchStatus;
  mode: 'party' | 'random';
  partyCode: string | null;
  player1Id: string | null;
  player2Id: string | null;
  player1Secret: number | null;
  player2Secret: number | null;
  board: number[];
  currentPlayer: PlayerSlot | null;
  phase: Phase | null;
  winnerId: string | null;
  endedReason: EndReason | null;
  firstPlayer: PlayerSlot | null;
  eliminated: Record<PlayerSlot, number[]>;
  createdAt: string;
  lastActivityAt: string;
  endedAt: string | null;
};

export type MatchEvent =
  | { type: 'DRAW_SECRET'; player: PlayerSlot; pokemonId: number }
  | { type: 'ASK'; player: PlayerSlot; question: string }
  | { type: 'ANSWER'; player: PlayerSlot; answer: string }
  | { type: 'GUESS'; player: PlayerSlot; pokemonId: number }
  | { type: 'CROSS_OFF'; player: PlayerSlot; pokemonId: number; eliminated: boolean }
  | { type: 'RESIGN'; player: PlayerSlot }
  /** `now` defaults to the current time; tests pass it explicitly to pin the clock. */
  | { type: 'CLAIM_INACTIVE'; player: PlayerSlot; now?: string };
