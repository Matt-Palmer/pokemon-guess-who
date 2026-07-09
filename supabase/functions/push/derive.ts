/**
 * Pure derivation from a `matches` row transition to the push notifications it
 * should produce. This is the Edge Function's entire decision logic — which
 * event happened, who the correct recipient is, and what the payload says —
 * kept dependency-free so the jest suite exercises it directly (the Deno
 * `index.ts` around it is a thin adapter, same pattern as the game reducer).
 *
 * The notified events are exactly the PRD's list: your turn / answer needed,
 * game ended, party joined, and claim available. Chat can never ping anyone by
 * construction — the webhook only fires on `matches` UPDATEs, never on
 * `match_events` inserts, and a question's notification is the *phase* change
 * it causes, not the message itself.
 */

/** The secret-stripped `matches` row the webhook trigger posts (old and new). */
export type MatchWebhookRow = {
  id: string;
  status: 'lobby' | 'active' | 'completed' | 'abandoned';
  player1_id: string;
  player2_id: string | null;
  player1_drawn: boolean;
  player2_drawn: boolean;
  current_player: 'player1' | 'player2' | null;
  phase: 'awaiting_question' | 'awaiting_answer' | null;
  winner_id: string | null;
  ended_reason: 'guess' | 'resign' | 'claim_inactive' | null;
  claim_notified: boolean;
};

export type PushKind =
  | 'party_joined'
  | 'your_turn'
  | 'answer_needed'
  | 'game_ended'
  | 'claim_available';

export type PushMessage = {
  kind: PushKind;
  /** Clerk id of the player this notification is for. */
  recipientId: string;
  title: string;
  body: string;
  /** expo-router path the app opens when the notification is tapped. */
  url: string;
};

type Slot = 'player1' | 'player2';

/** Usernames keyed by clerk id, for message copy. Missing names get a fallback. */
export type NameMap = Record<string, string | null | undefined>;

function other(slot: Slot): Slot {
  return slot === 'player1' ? 'player2' : 'player1';
}

function idOf(row: MatchWebhookRow, slot: Slot): string | null {
  return slot === 'player1' ? row.player1_id : row.player2_id;
}

function nameOf(names: NameMap, id: string | null): string {
  return (id && names[id]) || 'Your opponent';
}

/**
 * The slot that must act next for an active match — draw order first, then the
 * answerer during awaiting_answer, otherwise the current player. Used to pick
 * the claim-available recipient: the *opponent* of whoever is stalling.
 */
export function playerToMove(row: MatchWebhookRow): Slot {
  if (!row.player1_drawn) return 'player1';
  if (!row.player2_drawn) return 'player2';
  if (row.phase === 'awaiting_answer') return other(row.current_player ?? 'player1');
  return row.current_player ?? 'player1';
}

/**
 * All notifications warranted by an UPDATE that took `before` to `after`.
 *
 * Recipient rules per event:
 *  - party_joined     → the host (player1), who must now press Start.
 *  - your_turn        → the player the move passed to: player2 when player1's
 *                       draw makes it their draw, the coin-flipped first player
 *                       when the draw completes, and the new current player
 *                       when a turn passes during play. A turn the recipient
 *                       created themselves (answering passes the turn to the
 *                       answerer) is deliberately not notified.
 *  - answer_needed    → the asker's opponent, when the phase flips to
 *                       awaiting_answer.
 *  - game_ended       → both players, with win/loss copy per side phrased by
 *                       `ended_reason` (guess, resign, or inactivity claim —
 *                       all ride the same status edge). The actor's device
 *                       suppresses foreground presentation, so this is correct
 *                       whoever ended the game.
 *  - claim_available  → the waiting player (opponent of the one who must move),
 *                       when the cron scan flips claim_notified.
 *
 * Turn-pass copy is deliberately neutral: a wrong guess passes the turn, and
 * the PRD keeps guesses private, so the notification must never say (beyond
 * the already-public turn change) why the turn arrived.
 */
export function deriveNotifications(
  before: MatchWebhookRow,
  after: MatchWebhookRow,
  names: NameMap = {},
): PushMessage[] {
  // Someone joined the host's party.
  if (after.status === 'lobby' && !before.player2_id && after.player2_id) {
    return [
      {
        kind: 'party_joined',
        recipientId: after.player1_id,
        title: `${nameOf(names, after.player2_id)} joined your party!`,
        body: 'Head to your lobby — you can start the game.',
        url: `/lobby/${after.id}`,
      },
    ];
  }

  // The game ended. Notify both sides; completions without a winner (the
  // future abandoned path) notify no one, mirroring the stats trigger.
  // `ended_reason` shapes the copy: a resignation or an inactivity claim reads
  // very differently from a guessed secret. (The actor's own device suppresses
  // foreground presentation, so the resigner/claimer rarely sees theirs.)
  if (before.status !== 'completed' && after.status === 'completed') {
    if (!after.winner_id || !after.player2_id) return [];
    const loserId =
      after.winner_id === after.player1_id ? after.player2_id : after.player1_id;
    const winnerName = nameOf(names, after.winner_id);
    const loserName = nameOf(names, loserId);
    const bodies =
      after.ended_reason === 'resign'
        ? {
            winner: `${loserName} resigned — the win is yours.`,
            loser: `You resigned your game against ${winnerName}.`,
          }
        : after.ended_reason === 'claim_inactive'
          ? {
              winner: `You claimed your game against ${loserName} — 7 days without a move.`,
              loser: `${winnerName} claimed the win after 7 days without a move.`,
            }
          : {
              winner: `Your game against ${loserName} is over — victory!`,
              loser: `${winnerName} won this one — rematch?`,
            };
    return [
      {
        kind: 'game_ended',
        recipientId: after.winner_id,
        title: 'You won! 🎉',
        body: bodies.winner,
        url: `/match/${after.id}`,
      },
      {
        kind: 'game_ended',
        recipientId: loserId,
        title: 'Game over',
        body: bodies.loser,
        url: `/match/${after.id}`,
      },
    ];
  }

  // Everything below only applies to a live game with both seats filled.
  if (after.status !== 'active' || !after.player2_id) return [];

  // The hourly scan flagged this match as claimable by the waiting player.
  if (!before.claim_notified && after.claim_notified) {
    const mover = playerToMove(after);
    const recipientId = idOf(after, other(mover));
    if (!recipientId) return [];
    return [
      {
        kind: 'claim_available',
        recipientId,
        title: 'Claim your win',
        body: `${nameOf(names, idOf(after, mover))} hasn't moved in 7 days — you can claim this game.`,
        url: `/match/${after.id}`,
      },
    ];
  }

  // Player1 drew their secret; it's now player2's draw.
  if (!before.player1_drawn && after.player1_drawn && !after.player2_drawn) {
    return [
      {
        kind: 'your_turn',
        recipientId: after.player2_id,
        title: 'Your move',
        body: `${nameOf(names, after.player1_id)} drew their secret — time to draw yours.`,
        url: `/match/${after.id}`,
      },
    ];
  }

  // A question was asked: the opponent of the asker must answer.
  if (before.phase !== 'awaiting_answer' && after.phase === 'awaiting_answer') {
    if (!after.current_player) return [];
    const recipientId = idOf(after, other(after.current_player));
    if (!recipientId) return [];
    return [
      {
        kind: 'answer_needed',
        recipientId,
        title: 'Answer needed',
        body: `${nameOf(names, idOf(after, after.current_player))} asked you a question.`,
        url: `/match/${after.id}`,
      },
    ];
  }

  // The turn passed to someone who didn't cause it: the coin flip after the
  // draw completes (current_player null → set), or a turn pass while the phase
  // stays awaiting_question (today: the opponent guessed wrong — copy stays
  // neutral so the notification never reveals that). An answer also changes
  // current_player, but to the answerer themselves (old phase awaiting_answer),
  // so it's excluded.
  if (
    after.phase === 'awaiting_question' &&
    before.phase !== 'awaiting_answer' &&
    after.current_player &&
    after.current_player !== before.current_player
  ) {
    const recipientId = idOf(after, after.current_player);
    if (!recipientId) return [];
    const opponentName = nameOf(names, idOf(after, other(after.current_player)));
    const gameStart = before.current_player === null;
    return [
      {
        kind: 'your_turn',
        recipientId,
        title: gameStart ? 'Game on!' : 'Your move',
        body: gameStart
          ? `You go first against ${opponentName} — ask or guess.`
          : `It's your turn against ${opponentName} — ask or guess.`,
        url: `/match/${after.id}`,
      },
    ];
  }

  return [];
}

/** An Expo push API message (https://exp.host/--/api/v2/push/send). */
export type ExpoPushMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: { url: string; kind: PushKind };
};

/**
 * Attach each recipient's Expo push token. Recipients with no stored token
 * (never registered, or push unavailable on their install) are dropped —
 * there's nowhere to deliver to.
 */
export function toExpoMessages(
  messages: PushMessage[],
  tokens: Record<string, string | null | undefined>,
): ExpoPushMessage[] {
  const result: ExpoPushMessage[] = [];
  for (const m of messages) {
    const to = tokens[m.recipientId];
    if (!to) continue;
    result.push({
      to,
      sound: 'default',
      title: m.title,
      body: m.body,
      data: { url: m.url, kind: m.kind },
    });
  }
  return result;
}
