import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * RPC integration tests for random matchmaking against the live Supabase
 * project. The concurrency safety IS the acceptance criterion here, so these
 * hammer `find_random_game` with simultaneous calls and assert a pairing is
 * created exactly once and an opponent is never shared — the row-lock
 * mutex + FOR UPDATE SKIP LOCKED scheme the reducer can't cover.
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

/** Every distinct non-null match id among a set of find_random_game results. */
function distinctMatches(results: (string | null)[]): string[] {
  return [...new Set(results.filter((id): id is string => id !== null))];
}

(hasLiveConfig ? describe : describe.skip)('random matchmaking RPCs', () => {
  let waiter: SupabaseClient; // rlstest1 — enqueues first in the paired tests
  let joiner: SupabaseClient; // rlstest2

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    waiter = clientFor(jwtA);
    joiner = clientFor(jwtB);
    await waiter.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await joiner.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  }, 20000);

  // Every test must leave the queue empty — a leftover row would let the next
  // test pair against a stale search and assert nonsense.
  afterEach(async () => {
    await waiter.rpc('cancel_matchmaking');
    await joiner.rpc('cancel_matchmaking');
  });

  test(
    'first search waits; the second player pairs; the waiter picks the match up',
    async () => {
      const { data: searching, error: enqueueError } = await waiter.rpc('find_random_game');
      expect(enqueueError).toBeNull();
      expect(searching).toBeNull();

      const { data: matchId, error: pairError } = await joiner.rpc('find_random_game');
      expect(pairError).toBeNull();
      expect(matchId).toEqual(expect.any(String));

      // The waiter's next poll returns the same match, handed over via the
      // matched_match_id stamp on their queue row.
      const { data: pickedUp } = await waiter.rpc('find_random_game');
      expect(pickedUp).toBe(matchId);
    },
    20000,
  );

  test(
    'the paired match is a standard active random match with the waiter in the player1 seat',
    async () => {
      await waiter.rpc('find_random_game');
      const { data: matchId } = await joiner.rpc('find_random_game');
      await waiter.rpc('find_random_game'); // pick up, clearing the queue row

      const { data: match, error } = await joiner
        .from('matches')
        .select('id, status, mode, party_code, player1_id, player2_id, board, current_player, phase')
        .eq('id', matchId)
        .single();

      expect(error).toBeNull();
      expect(match!.mode).toBe('random');
      expect(match!.status).toBe('active'); // no lobby — straight to the blind draw
      expect(match!.party_code).toBeNull();
      expect(match!.player1_id).toBe(CLERK_TEST_USER_1); // longest-waiting draws first
      expect(match!.player2_id).toBe(CLERK_TEST_USER_2);
      expect(match!.board).toHaveLength(24);
      expect(new Set(match!.board).size).toBe(24);
      expect(match!.current_player).toBeNull(); // play begins after the draw
    },
    20000,
  );

  test(
    'cancelling removes the player from the queue: a cancelled search is never paired',
    async () => {
      await waiter.rpc('find_random_game');
      const { data: cancelled, error } = await waiter.rpc('cancel_matchmaking');
      expect(error).toBeNull();
      expect(cancelled).toBeNull(); // no pairing had landed

      // With the queue empty again, the other player just starts searching.
      const { data: result } = await joiner.rpc('find_random_game');
      expect(result).toBeNull();
    },
    20000,
  );

  test(
    'cancelling after a pairing already landed returns that match instead of stranding the opponent',
    async () => {
      await waiter.rpc('find_random_game');
      const { data: matchId } = await joiner.rpc('find_random_game');

      // The waiter cancels before ever polling — but the opponent is already
      // committed to a real game, so the cancel hands the match back.
      const { data: cancelled } = await waiter.rpc('cancel_matchmaking');
      expect(cancelled).toBe(matchId);
    },
    20000,
  );

  test(
    'concurrent pairing attempts against one waiter create exactly one match',
    async () => {
      await waiter.rpc('find_random_game');

      const results = await Promise.all(
        Array.from({ length: 6 }, () => joiner.rpc('find_random_game')),
      );
      for (const { error } of results) expect(error).toBeNull();

      // Exactly one of the six claimed the waiter; the rest found the row
      // already matched (or locked) and stayed searching.
      const matches = distinctMatches(results.map(({ data }) => data as string | null));
      expect(matches).toHaveLength(1);

      // And the waiter was handed exactly that match, not a second one.
      const { data: pickedUp } = await waiter.rpc('find_random_game');
      expect(pickedUp).toBe(matches[0]);
    },
    30000,
  );

  test(
    'two players searching simultaneously converge on exactly one shared match',
    async () => {
      // Model the real client: each player runs ONE sequential, jittered poll
      // loop (useMatchmaking never overlaps its own requests), and both loops
      // start at the same instant. This is the mutual-scan race: when the two
      // pairing attempts collide, the own-row locks make them skip each other
      // (rather than each grabbing the other and creating two matches) and a
      // later, jitter-desynced tick resolves the pairing — exactly once.
      const pollUntilMatched = async (client: SupabaseClient): Promise<string | null> => {
        for (let i = 0; i < 15; i++) {
          const { data, error } = await client.rpc('find_random_game');
          expect(error).toBeNull();
          if (data) return data as string;
          await new Promise((r) => setTimeout(r, 50 + Math.random() * 200));
        }
        return null;
      };

      const [waiterMatch, joinerMatch] = await Promise.all([
        pollUntilMatched(waiter),
        pollUntilMatched(joiner),
      ]);

      expect(waiterMatch).toEqual(expect.any(String));
      expect(joinerMatch).toBe(waiterMatch);
    },
    30000,
  );

  test(
    'a matched game plays the standard blind draw into active play',
    async () => {
      await waiter.rpc('find_random_game');
      const { data: matchId } = await joiner.rpc('find_random_game');
      await waiter.rpc('find_random_game');

      const { data: match } = await joiner
        .from('matches')
        .select('board')
        .eq('id', matchId)
        .single();
      const board = match!.board as number[];

      // Standard draw order: player1 (the waiter) first, then player2.
      const { error: draw1 } = await waiter.rpc('draw_secret', {
        p_match_id: matchId,
        p_pokemon_id: board[0],
      });
      expect(draw1).toBeNull();
      const { error: draw2 } = await joiner.rpc('draw_secret', {
        p_match_id: matchId,
        p_pokemon_id: board[1],
      });
      expect(draw2).toBeNull();

      const { data: inPlay } = await waiter
        .from('matches')
        .select('status, phase, first_player, current_player, player1_drawn, player2_drawn')
        .eq('id', matchId)
        .single();
      expect(inPlay!.status).toBe('active');
      expect(inPlay!.phase).toBe('awaiting_question');
      expect(inPlay!.player1_drawn).toBe(true);
      expect(inPlay!.player2_drawn).toBe(true);
      expect(['player1', 'player2']).toContain(inPlay!.first_player);
      expect(inPlay!.current_player).toBe(inPlay!.first_player);

      // Indistinguishable from a party game to the home screen, too.
      const { data: list } = await waiter.rpc('my_matches');
      const listed = (list as { id: string; opponent_username: string }[]).find(
        (m) => m.id === matchId,
      );
      expect(listed).toBeDefined();
      expect(listed!.opponent_username).toBe('rlstest2');
    },
    30000,
  );

  test('anon cannot call the matchmaking RPCs', async () => {
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { error: findError } = await anon.rpc('find_random_game');
    expect(findError).not.toBeNull();
    const { error: cancelError } = await anon.rpc('cancel_matchmaking');
    expect(cancelError).not.toBeNull();
  });

  test('the queue is not directly readable or writable by clients', async () => {
    const { error: readError } = await waiter.from('matchmaking_queue').select('*');
    expect(readError).not.toBeNull();

    const { error: writeError } = await waiter
      .from('matchmaking_queue')
      .insert({ user_id: CLERK_TEST_USER_1 });
    expect(writeError).not.toBeNull();
  });
});
