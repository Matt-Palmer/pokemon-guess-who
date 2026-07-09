import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * RPC integration tests for the party lifecycle against the live Supabase
 * project. These exercise the atomic/race-sensitive server operations the
 * reducer can't cover: unique code allocation, join rejection modes, and
 * server-side board generation producing one identical shared board.
 *
 * Requires the same live config as rls.test.ts (Clerk secret + two test users);
 * skips automatically when unconfigured.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_TEST_USER_1 = process.env.CLERK_TEST_USER_1_ID;
const CLERK_TEST_USER_2 = process.env.CLERK_TEST_USER_2_ID;

const hasLiveConfig =
  SUPABASE_URL && SUPABASE_ANON_KEY && CLERK_SECRET_KEY && CLERK_TEST_USER_1 && CLERK_TEST_USER_2;

const CODE_ALPHABET = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

async function mintSessionToken(userId: string): Promise<string> {
  const sessionRes = await fetch('https://api.clerk.com/v1/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const session = await sessionRes.json();

  const tokenRes = await fetch(`https://api.clerk.com/v1/sessions/${session.id}/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const token = await tokenRes.json();
  return token.jwt;
}

function clientFor(jwt: string) {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    accessToken: async () => jwt,
  });
}

(hasLiveConfig ? describe : describe.skip)('party create/join RPCs', () => {
  let host: SupabaseClient;
  let joiner: SupabaseClient;

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    host = clientFor(jwtA);
    joiner = clientFor(jwtB);

    // Both users need a profile row (FK target for matches.player{1,2}_id).
    await host.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await joiner.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  });

  test('create_party returns a 6-char code from the unambiguous alphabet', async () => {
    const { data, error } = await host.rpc('create_party');
    expect(error).toBeNull();
    expect(data.status).toBe('lobby');
    expect(data.mode).toBe('party');
    expect(data.player1_id).toBe(CLERK_TEST_USER_1);
    expect(data.party_code).toMatch(CODE_ALPHABET);
  });

  test('consecutive parties receive distinct codes', async () => {
    const { data: a } = await host.rpc('create_party');
    const { data: b } = await host.rpc('create_party');
    expect(a.party_code).not.toBe(b.party_code);
  });

  test('a second player can join with a valid code', async () => {
    const { data: party } = await host.rpc('create_party');
    const { data: joined, error } = await joiner.rpc('join_party', { p_code: party.party_code });
    expect(error).toBeNull();
    expect(joined.id).toBe(party.id);
    expect(joined.player2_id).toBe(CLERK_TEST_USER_2);
  });

  test('joining is case- and whitespace-insensitive', async () => {
    const { data: party } = await host.rpc('create_party');
    const { data: joined, error } = await joiner.rpc('join_party', {
      p_code: `  ${party.party_code.toLowerCase()} `,
    });
    expect(error).toBeNull();
    expect(joined.id).toBe(party.id);
  });

  test('an unknown code is rejected as invalid_code', async () => {
    const { error } = await joiner.rpc('join_party', { p_code: 'ZZZZZZ' });
    expect(error?.message).toContain('invalid_code');
  });

  test('a full party is rejected', async () => {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    // The same player re-joining hits the occupied second seat → full.
    const { error } = await joiner.rpc('join_party', { p_code: party.party_code });
    expect(error?.message).toContain('full');
  });

  test('an in-progress party is rejected', async () => {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    await host.rpc('start_match', { p_match_id: party.id });
    const { error } = await joiner.rpc('join_party', { p_code: party.party_code });
    expect(error?.message).toContain('in_progress');
  });

  test('you cannot join your own party', async () => {
    const { data: party } = await host.rpc('create_party');
    const { error } = await host.rpc('join_party', { p_code: party.party_code });
    expect(error?.message).toContain('own_party');
  });
});

(hasLiveConfig ? describe : describe.skip)('server-side board generation', () => {
  let host: SupabaseClient;
  let joiner: SupabaseClient;

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    host = clientFor(jwtA);
    joiner = clientFor(jwtB);
    await host.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await joiner.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  });

  test('start_match draws 24 distinct cards, identical for both players', async () => {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    const { data: started, error } = await host.rpc('start_match', { p_match_id: party.id });

    expect(error).toBeNull();
    expect(started.status).toBe('active');
    expect(started.board).toHaveLength(24);
    expect(new Set(started.board).size).toBe(24);

    // Both players read the identical board that the server generated once.
    const { data: hostView } = await host.from('matches').select('board').eq('id', party.id).single();
    const { data: joinerView } = await joiner.from('matches').select('board').eq('id', party.id).single();
    expect(hostView?.board).toEqual(joinerView?.board);
    expect(joinerView?.board).toEqual(started.board);
  });

  test('only the host can start the match', async () => {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    const { error } = await joiner.rpc('start_match', { p_match_id: party.id });
    expect(error?.message).toContain('only_host_can_start');
  });

  test('a party with no opponent cannot start', async () => {
    const { data: party } = await host.rpc('create_party');
    const { error } = await host.rpc('start_match', { p_match_id: party.id });
    expect(error?.message).toContain('no_opponent');
  });
});

(hasLiveConfig ? describe : describe.skip)('blind draw (draw_secret / my_secret)', () => {
  let host: SupabaseClient;
  let joiner: SupabaseClient;

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    host = clientFor(jwtA);
    joiner = clientFor(jwtB);
    await host.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await joiner.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  });

  /** Create → join → start, returning the started match (host is player1). */
  async function startedMatch() {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    const { data: started } = await host.rpc('start_match', { p_match_id: party.id });
    return started;
  }

  test('both players draw distinct secrets and the match opens into active play', async () => {
    const match = await startedMatch();
    const [first, second] = match.board;

    const { error: e1 } = await host.rpc('draw_secret', { p_match_id: match.id, p_pokemon_id: first });
    expect(e1).toBeNull();
    const { error: e2 } = await joiner.rpc('draw_secret', { p_match_id: match.id, p_pokemon_id: second });
    expect(e2).toBeNull();

    // Each player reads only their own secret, and the two are distinct.
    const { data: p1Secret } = await host.rpc('my_secret', { p_match_id: match.id });
    const { data: p2Secret } = await joiner.rpc('my_secret', { p_match_id: match.id });
    expect(p1Secret).toBe(first);
    expect(p2Secret).toBe(second);
    expect(p1Secret).not.toBe(p2Secret);

    // Second draw flips the match into active play with a coin-flip first turn.
    const { data: row } = await host
      .from('matches')
      .select('player1_drawn, player2_drawn, phase, current_player')
      .eq('id', match.id)
      .single();
    expect(row?.player1_drawn).toBe(true);
    expect(row?.player2_drawn).toBe(true);
    expect(row?.phase).toBe('awaiting_question');
    expect(['player1', 'player2']).toContain(row?.current_player);
  });

  test('player 2 cannot draw before player 1 (turn order)', async () => {
    const match = await startedMatch();
    const { error } = await joiner.rpc('draw_secret', {
      p_match_id: match.id,
      p_pokemon_id: match.board[0],
    });
    expect(error?.message).toContain('awaiting_player1');
  });

  test("player 2 cannot draw player 1's card — secrets stay distinct", async () => {
    const match = await startedMatch();
    await host.rpc('draw_secret', { p_match_id: match.id, p_pokemon_id: match.board[0] });
    const { error } = await joiner.rpc('draw_secret', {
      p_match_id: match.id,
      p_pokemon_id: match.board[0],
    });
    expect(error?.message).toContain('card_taken');
  });

  test('a card off the board cannot be drawn', async () => {
    const match = await startedMatch();
    const { error } = await host.rpc('draw_secret', { p_match_id: match.id, p_pokemon_id: 999999 });
    expect(error?.message).toContain('not_on_board');
  });

  test('a player cannot read the opponent’s secret via the Data API', async () => {
    const match = await startedMatch();
    await host.rpc('draw_secret', { p_match_id: match.id, p_pokemon_id: match.board[0] });

    // Column-level privileges forbid selecting the secret columns at all.
    const { error } = await joiner.from('matches').select('player1_secret').eq('id', match.id).single();
    expect(error).not.toBeNull();

    // my_secret only ever returns the caller's own secret — null before they draw.
    const { data: joinerSees } = await joiner.rpc('my_secret', { p_match_id: match.id });
    expect(joinerSees).toBeNull();
  });
});

(hasLiveConfig ? describe : describe.skip)('turn loop (ask/answer) & private board marks', () => {
  let host: SupabaseClient;
  let joiner: SupabaseClient;

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    host = clientFor(jwtA);
    joiner = clientFor(jwtB);
    await host.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await joiner.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  });

  /** Drive a match all the way to active play (both secrets drawn). */
  async function playingMatch() {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    const { data: started } = await host.rpc('start_match', { p_match_id: party.id });
    await host.rpc('draw_secret', { p_match_id: started.id, p_pokemon_id: started.board[0] });
    await joiner.rpc('draw_secret', { p_match_id: started.id, p_pokemon_id: started.board[1] });
    const { data: row } = await host
      .from('matches')
      .select('current_player')
      .eq('id', started.id)
      .single();
    // The first turn is a server coin flip; resolve which client is the asker.
    const asker = row!.current_player === 'player1' ? host : joiner;
    const answerer = row!.current_player === 'player1' ? joiner : host;
    return { match: started, current: row!.current_player as 'player1' | 'player2', asker, answerer };
  }

  test('the current player asks, the opponent answers, and the turn passes', async () => {
    const { match, current, asker, answerer } = await playingMatch();

    const { data: q, error: qErr } = await asker.rpc('ask_question', {
      p_match_id: match.id,
      p_question: 'Is it a fire type?',
    });
    expect(qErr).toBeNull();
    expect(q.kind).toBe('question');

    // The question flips the phase but keeps the turn with the asker.
    const { data: afterAsk } = await asker
      .from('matches')
      .select('phase, current_player')
      .eq('id', match.id)
      .single();
    expect(afterAsk?.phase).toBe('awaiting_answer');
    expect(afterAsk?.current_player).toBe(current);

    const { data: a, error: aErr } = await answerer.rpc('answer_question', {
      p_match_id: match.id,
      p_answer: 'No',
    });
    expect(aErr).toBeNull();
    expect(a.kind).toBe('answer');

    // Answering passes the turn and returns to awaiting_question.
    const { data: afterAnswer } = await asker
      .from('matches')
      .select('phase, current_player')
      .eq('id', match.id)
      .single();
    expect(afterAnswer?.phase).toBe('awaiting_question');
    expect(afterAnswer?.current_player).not.toBe(current);

    // The full thread is persisted and identical for both players.
    const { data: askerThread } = await asker
      .from('match_events')
      .select('kind, body')
      .eq('match_id', match.id)
      .order('created_at', { ascending: true });
    const { data: answererThread } = await answerer
      .from('match_events')
      .select('kind, body')
      .eq('match_id', match.id)
      .order('created_at', { ascending: true });
    expect(askerThread).toEqual([
      { kind: 'question', body: 'Is it a fire type?' },
      { kind: 'answer', body: 'No' },
    ]);
    expect(answererThread).toEqual(askerThread);
  });

  test('a player cannot ask when it is not their turn', async () => {
    const { match, answerer } = await playingMatch();
    const { error } = await answerer.rpc('ask_question', {
      p_match_id: match.id,
      p_question: 'Is it blue?',
    });
    expect(error?.message).toContain('not_your_turn');
  });

  test('the asking player cannot answer their own question', async () => {
    const { match, asker } = await playingMatch();
    await asker.rpc('ask_question', { p_match_id: match.id, p_question: 'Fire?' });
    const { error } = await asker.rpc('answer_question', { p_match_id: match.id, p_answer: 'Yes' });
    expect(error?.message).toContain('not_your_turn');
  });

  test('cannot answer when no question is pending', async () => {
    const { match, answerer } = await playingMatch();
    const { error } = await answerer.rpc('answer_question', { p_match_id: match.id, p_answer: 'No' });
    expect(error?.message).toContain('no_pending_question');
  });

  test('board marks are private — the opponent never sees them', async () => {
    const { match } = await playingMatch();
    const target = match.board[5];

    const { error } = await host.rpc('set_board_mark', {
      p_match_id: match.id,
      p_pokemon_id: target,
      p_eliminated: true,
    });
    expect(error).toBeNull();

    // The owner sees their own mark…
    const { data: mine } = await host
      .from('board_marks')
      .select('pokemon_id')
      .eq('match_id', match.id);
    expect(mine?.map((m) => m.pokemon_id)).toContain(target);

    // …but the opponent's RLS scopes board_marks to their own rows only.
    const { data: theirs } = await joiner
      .from('board_marks')
      .select('pokemon_id')
      .eq('match_id', match.id);
    expect(theirs).toEqual([]);

    // Un-crossing removes the mark.
    await host.rpc('set_board_mark', { p_match_id: match.id, p_pokemon_id: target, p_eliminated: false });
    const { data: after } = await host
      .from('board_marks')
      .select('pokemon_id')
      .eq('match_id', match.id)
      .eq('pokemon_id', target);
    expect(after).toEqual([]);
  });

  test('crossing off is not turn-gated — a player may mark on the opponent’s turn', async () => {
    const { match, answerer } = await playingMatch();
    // `answerer` is the non-current player; they can still mark their own board.
    const { error } = await answerer.rpc('set_board_mark', {
      p_match_id: match.id,
      p_pokemon_id: match.board[3],
      p_eliminated: true,
    });
    expect(error).toBeNull();
  });
});

(hasLiveConfig ? describe : describe.skip)('guessing & win/loss (guess / match_result)', () => {
  let host: SupabaseClient;
  let joiner: SupabaseClient;

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    host = clientFor(jwtA);
    joiner = clientFor(jwtB);
    await host.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await joiner.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  });

  /**
   * Drive a match to active play and resolve the coin-flipped first turn.
   * host is player1 and draws board[0]; joiner is player2 and draws board[1] —
   * so the current player's opponent's secret is a known board card.
   */
  async function playingMatch() {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    const { data: started } = await host.rpc('start_match', { p_match_id: party.id });
    await host.rpc('draw_secret', { p_match_id: started.id, p_pokemon_id: started.board[0] });
    await joiner.rpc('draw_secret', { p_match_id: started.id, p_pokemon_id: started.board[1] });
    const { data: row } = await host
      .from('matches')
      .select('current_player')
      .eq('id', started.id)
      .single();
    const currentIsP1 = row!.current_player === 'player1';
    const guesser = currentIsP1 ? host : joiner;
    const opponent = currentIsP1 ? joiner : host;
    const opponentSecret = currentIsP1 ? started.board[1] : started.board[0];
    const wrongCard = (started.board as number[]).find((c) => c !== opponentSecret)!;
    return { match: started, guesser, opponent, opponentSecret, wrongCard, currentIsP1 };
  }

  test('a correct guess wins the match and reveals both secrets to both players', async () => {
    const { match, guesser, opponent, opponentSecret, currentIsP1 } = await playingMatch();
    const winnerId = currentIsP1 ? CLERK_TEST_USER_1 : CLERK_TEST_USER_2;

    const { data: result, error } = await guesser.rpc('guess', {
      p_match_id: match.id,
      p_pokemon_id: opponentSecret,
    });
    expect(error).toBeNull();
    expect(result.correct).toBe(true);
    expect(result.winner_id).toBe(winnerId);

    const { data: row } = await guesser
      .from('matches')
      .select('status, winner_id, ended_at')
      .eq('id', match.id)
      .single();
    expect(row?.status).toBe('completed');
    expect(row?.winner_id).toBe(winnerId);
    expect(row?.ended_at).not.toBeNull();

    // Once the game is over, both players can read the reveal (both secrets).
    for (const client of [guesser, opponent]) {
      const { data: reveal } = await client.rpc('match_result', { p_match_id: match.id });
      expect(reveal).toHaveLength(1);
      expect(reveal[0].winner_id).toBe(winnerId);
      expect(reveal[0].player1_secret).toBe(match.board[0]);
      expect(reveal[0].player2_secret).toBe(match.board[1]);
    }
  });

  test('a wrong guess auto-crosses the missed card, passes the turn, and stays private', async () => {
    const { match, guesser, opponent, wrongCard, currentIsP1 } = await playingMatch();

    const { data: result, error } = await guesser.rpc('guess', {
      p_match_id: match.id,
      p_pokemon_id: wrongCard,
    });
    expect(error).toBeNull();
    expect(result.correct).toBe(false);
    // A wrong guess never returns the opponent's secret, even to the guesser.
    expect(result.winner_id).toBeNull();
    expect(result.opponent_secret).toBeNull();

    // The match stays active, the turn passes, and the phase returns to asking.
    const { data: row } = await guesser
      .from('matches')
      .select('status, winner_id, current_player, phase')
      .eq('id', match.id)
      .single();
    expect(row?.status).toBe('active');
    expect(row?.winner_id).toBeNull();
    expect(row?.current_player).toBe(currentIsP1 ? 'player2' : 'player1');
    expect(row?.phase).toBe('awaiting_question');

    // The missed card is auto-crossed on the guesser's own (private) board…
    const { data: mine } = await guesser
      .from('board_marks')
      .select('pokemon_id')
      .eq('match_id', match.id);
    expect(mine?.map((m) => m.pokemon_id)).toContain(wrongCard);

    // …and nothing about the guess reaches the opponent: no mark, no thread entry.
    const { data: theirMarks } = await opponent
      .from('board_marks')
      .select('pokemon_id')
      .eq('match_id', match.id);
    expect(theirMarks).toEqual([]);
    const { data: thread } = await opponent
      .from('match_events')
      .select('id')
      .eq('match_id', match.id);
    expect(thread).toEqual([]);

    // match_result reveals nothing while the game is still in progress.
    const { data: reveal } = await opponent.rpc('match_result', { p_match_id: match.id });
    expect(reveal).toEqual([]);
  });

  test('a player cannot guess when it is not their turn', async () => {
    const { match, opponent } = await playingMatch();
    const { error } = await opponent.rpc('guess', {
      p_match_id: match.id,
      p_pokemon_id: match.board[0],
    });
    expect(error?.message).toContain('not_your_turn');
  });

  test('a player cannot ask and guess in the same turn (ask XOR guess)', async () => {
    const { match, guesser, opponentSecret } = await playingMatch();
    await guesser.rpc('ask_question', { p_match_id: match.id, p_question: 'Fire?' });
    const { error } = await guesser.rpc('guess', {
      p_match_id: match.id,
      p_pokemon_id: opponentSecret,
    });
    expect(error?.message).toContain('not_awaiting_question');
  });

  test('a card off the board cannot be guessed', async () => {
    const { match, guesser } = await playingMatch();
    const { error } = await guesser.rpc('guess', { p_match_id: match.id, p_pokemon_id: 999999 });
    expect(error?.message).toContain('not_on_board');
  });
});

(hasLiveConfig ? describe : describe.skip)('stats on game end', () => {
  let host: SupabaseClient;
  let joiner: SupabaseClient;

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    host = clientFor(jwtA);
    joiner = clientFor(jwtB);
    await host.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await joiner.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  });

  type StatsRow = {
    games_played: number;
    wins: number;
    losses: number;
    current_streak: number;
    best_streak: number;
  };

  /** Each client can only read its own profile row (RLS), so no id filter needed. */
  async function statsFor(client: SupabaseClient): Promise<StatsRow> {
    const { data, error } = await client
      .from('profiles')
      .select('games_played, wins, losses, current_streak, best_streak')
      .single();
    expect(error).toBeNull();
    return data as StatsRow;
  }

  /** Drive a match to active play; resolve the coin flip into guesser/opponent. */
  async function playingMatch() {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    const { data: started } = await host.rpc('start_match', { p_match_id: party.id });
    await host.rpc('draw_secret', { p_match_id: started.id, p_pokemon_id: started.board[0] });
    await joiner.rpc('draw_secret', { p_match_id: started.id, p_pokemon_id: started.board[1] });
    const { data: row } = await host
      .from('matches')
      .select('current_player')
      .eq('id', started.id)
      .single();
    const currentIsP1 = row!.current_player === 'player1';
    const guesser = currentIsP1 ? host : joiner;
    const opponent = currentIsP1 ? joiner : host;
    const opponentSecret = currentIsP1 ? started.board[1] : started.board[0];
    const wrongCard = (started.board as number[]).find((c) => c !== opponentSecret)!;
    return { match: started, guesser, opponent, opponentSecret, wrongCard };
  }

  test('a completed game updates the winner and loser atomically', async () => {
    const { match, guesser, opponent, opponentSecret } = await playingMatch();
    const winnerBefore = await statsFor(guesser);
    const loserBefore = await statsFor(opponent);

    const { error } = await guesser.rpc('guess', { p_match_id: match.id, p_pokemon_id: opponentSecret });
    expect(error).toBeNull();

    // Both records reflect the game the moment the game-ending RPC returns —
    // the trigger runs in the same transaction as the status flip.
    const winnerAfter = await statsFor(guesser);
    expect(winnerAfter.games_played).toBe(winnerBefore.games_played + 1);
    expect(winnerAfter.wins).toBe(winnerBefore.wins + 1);
    expect(winnerAfter.losses).toBe(winnerBefore.losses);
    expect(winnerAfter.current_streak).toBe(winnerBefore.current_streak + 1);
    expect(winnerAfter.best_streak).toBe(
      Math.max(winnerBefore.best_streak, winnerBefore.current_streak + 1),
    );

    const loserAfter = await statsFor(opponent);
    expect(loserAfter.games_played).toBe(loserBefore.games_played + 1);
    expect(loserAfter.losses).toBe(loserBefore.losses + 1);
    expect(loserAfter.wins).toBe(loserBefore.wins);
    expect(loserAfter.current_streak).toBe(0);
    expect(loserAfter.best_streak).toBe(loserBefore.best_streak);
  });

  test('a wrong guess leaves both records untouched — only game end counts', async () => {
    const { match, guesser, opponent, wrongCard } = await playingMatch();
    const guesserBefore = await statsFor(guesser);
    const opponentBefore = await statsFor(opponent);

    const { error } = await guesser.rpc('guess', { p_match_id: match.id, p_pokemon_id: wrongCard });
    expect(error).toBeNull();

    expect(await statsFor(guesser)).toEqual(guesserBefore);
    expect(await statsFor(opponent)).toEqual(opponentBefore);
  });

  test('stat counters are not client-writable (column-level privileges)', async () => {
    const { error } = await host
      .from('profiles')
      .update({ wins: 9999 })
      .eq('clerk_id', CLERK_TEST_USER_1!);
    expect(error?.message).toMatch(/permission denied/i);

    // Identity columns stay editable — only the counters are locked down.
    const { error: usernameError } = await host
      .from('profiles')
      .update({ username: 'rlstest1' })
      .eq('clerk_id', CLERK_TEST_USER_1!);
    expect(usernameError).toBeNull();
  });

  test('counters are recomputable from the matches history of record', async () => {
    const { data: recomputed, error } = await host.rpc('recompute_my_stats');
    expect(error).toBeNull();

    // Replay the caller's readable completed-match history client-side and
    // check the order-independent aggregates agree with the rebuild.
    const { data: history } = await host
      .from('matches')
      .select('winner_id')
      .eq('status', 'completed')
      .not('winner_id', 'is', null);
    const games = history!.length;
    const wins = history!.filter((m) => m.winner_id === CLERK_TEST_USER_1).length;

    expect(recomputed.games_played).toBe(games);
    expect(recomputed.wins).toBe(wins);
    expect(recomputed.losses).toBe(games - wins);
    expect(recomputed.wins + recomputed.losses).toBe(recomputed.games_played);
    expect(recomputed.best_streak).toBeGreaterThanOrEqual(recomputed.current_streak);

    // The rebuild is persisted on the profile row itself.
    expect(await statsFor(host)).toEqual({
      games_played: recomputed.games_played,
      wins: recomputed.wins,
      losses: recomputed.losses,
      current_streak: recomputed.current_streak,
      best_streak: recomputed.best_streak,
    });
  });
});

(hasLiveConfig ? describe : describe.skip)('async & multiple games (my_matches)', () => {
  let host: SupabaseClient;
  let joiner: SupabaseClient;

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    host = clientFor(jwtA);
    joiner = clientFor(jwtB);
    await host.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await joiner.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  });

  async function listFor(client: SupabaseClient): Promise<any[]> {
    const { data, error } = await client.rpc('my_matches');
    expect(error).toBeNull();
    return data as any[];
  }

  /** Drive a match through join/start/draws; resolve the coin flip into asker/answerer. */
  async function activeMatch() {
    const { data: party } = await host.rpc('create_party');
    await joiner.rpc('join_party', { p_code: party.party_code });
    const { data: started } = await host.rpc('start_match', { p_match_id: party.id });
    await host.rpc('draw_secret', { p_match_id: started.id, p_pokemon_id: started.board[0] });
    await joiner.rpc('draw_secret', { p_match_id: started.id, p_pokemon_id: started.board[1] });
    const { data: row } = await host
      .from('matches')
      .select('current_player')
      .eq('id', started.id)
      .single();
    const askerSlot = row!.current_player as 'player1' | 'player2';
    return {
      id: started.id as string,
      board: started.board as number[],
      askerSlot,
      asker: askerSlot === 'player1' ? host : joiner,
      answerer: askerSlot === 'player1' ? joiner : host,
    };
  }

  test('my_matches shows the game to both players with the correct opponent', async () => {
    const { data: party } = await host.rpc('create_party');

    // Open lobby: listed for the host with the seat still empty.
    let row = (await listFor(host)).find((r) => r.id === party.id);
    expect(row.status).toBe('lobby');
    expect(row.party_code).toBe(party.party_code);
    expect(row.opponent_username).toBeNull();

    await joiner.rpc('join_party', { p_code: party.party_code });

    // Each player sees the *other* as the opponent.
    row = (await listFor(host)).find((r) => r.id === party.id);
    expect(row.opponent_username).toBe('rlstest2');
    const joinerRow = (await listFor(joiner)).find((r) => r.id === party.id);
    expect(joinerRow.opponent_username).toBe('rlstest1');

    // The list mirrors the client-granted match columns — never the secrets.
    expect(row).not.toHaveProperty('player1_secret');
    expect(row).not.toHaveProperty('player2_secret');
  });

  test('my_matches is not callable anonymously', async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { error } = await anon.rpc('my_matches');
    expect(error?.message).toMatch(/permission denied/i);
  });

  test('a player holds multiple concurrent games, each independent', async () => {
    const a = await activeMatch();
    const b = await activeMatch();

    await a.asker.rpc('ask_question', { p_match_id: a.id, p_question: 'Is it red?' });

    // Acting in A advanced only A; B still awaits its first question.
    const { data: rowA } = await host.from('matches').select('phase').eq('id', a.id).single();
    const { data: rowB } = await host.from('matches').select('phase').eq('id', b.id).single();
    expect(rowA!.phase).toBe('awaiting_answer');
    expect(rowB!.phase).toBe('awaiting_question');

    // Both are listed, most recently active first (A just acted).
    const ids = (await listFor(host)).map((r) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
  });

  test('a finished game leaves the active list', async () => {
    const m = await activeMatch();
    const opponentSecret = m.askerSlot === 'player1' ? m.board[1] : m.board[0];
    await m.asker.rpc('guess', { p_match_id: m.id, p_pokemon_id: opponentSecret });

    const ids = (await listFor(host)).map((r) => r.id);
    expect(ids).not.toContain(m.id);
  });

  test('resume rehydrates the full match state from Postgres', async () => {
    const m = await activeMatch();
    await m.asker.rpc('ask_question', { p_match_id: m.id, p_question: 'Does it have wings?' });
    await m.answerer.rpc('answer_question', { p_match_id: m.id, p_answer: 'Yes' });
    await m.asker.rpc('set_board_mark', { p_match_id: m.id, p_pokemon_id: m.board[2], p_eliminated: true });
    await m.asker.rpc('set_board_mark', { p_match_id: m.id, p_pokemon_id: m.board[3], p_eliminated: true });

    // A "fresh app open" is a brand-new client: no cached state, everything the
    // match screen mounts from must come back from Postgres.
    const askerUserId = m.askerSlot === 'player1' ? CLERK_TEST_USER_1! : CLERK_TEST_USER_2!;
    const fresh = clientFor(await mintSessionToken(askerUserId));

    const listed = (await listFor(fresh)).find((r) => r.id === m.id);
    expect(listed.status).toBe('active');
    expect(listed.board).toEqual(m.board);
    expect(listed.phase).toBe('awaiting_question');
    expect(listed.current_player).not.toBe(m.askerSlot); // the answer passed the turn

    const { data: secret } = await fresh.rpc('my_secret', { p_match_id: m.id });
    expect(secret).toBe(m.askerSlot === 'player1' ? m.board[0] : m.board[1]);

    const { data: events } = await fresh
      .from('match_events')
      .select('kind, body')
      .eq('match_id', m.id)
      .order('created_at', { ascending: true });
    expect(events).toEqual([
      { kind: 'question', body: 'Does it have wings?' },
      { kind: 'answer', body: 'Yes' },
    ]);

    const { data: marks } = await fresh.from('board_marks').select('pokemon_id').eq('match_id', m.id);
    expect(new Set(marks!.map((r) => r.pokemon_id))).toEqual(new Set([m.board[2], m.board[3]]));
  });
});
