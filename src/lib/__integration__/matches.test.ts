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
