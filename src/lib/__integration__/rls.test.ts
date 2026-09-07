import { createClient } from '@supabase/supabase-js';

/**
 * Exercises real Clerk-issued JWTs against the live Supabase project to prove
 * RLS enforces per-user isolation. Requires CLERK_SECRET_KEY and a Clerk app
 * whose session tokens carry a `role: authenticated` claim (see the
 * Third-Party Auth setup in the PRD). Skips automatically if unconfigured so
 * the rest of the suite still runs without live credentials.
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

(hasLiveConfig ? describe : describe.skip)('RLS enforces per-user profile isolation', () => {
  let clientA: ReturnType<typeof clientFor>;
  let clientB: ReturnType<typeof clientFor>;

  beforeAll(async () => {
    const [jwtA, jwtB] = await Promise.all([
      mintSessionToken(CLERK_TEST_USER_1!),
      mintSessionToken(CLERK_TEST_USER_2!),
    ]);
    clientA = clientFor(jwtA);
    clientB = clientFor(jwtB);

    await clientA.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_1, username: 'rlstest1' });
    await clientB.from('profiles').upsert({ clerk_id: CLERK_TEST_USER_2, username: 'rlstest2' });
  });

  test('any authenticated user can read the pokemon reference table', async () => {
    const { data, error } = await clientA.from('pokemon').select('id').limit(1);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test('a user can read their own profile', async () => {
    const { data, error } = await clientA.from('profiles').select('*').eq('clerk_id', CLERK_TEST_USER_1).single();
    expect(error).toBeNull();
    expect(data?.username).toBe('rlstest1');
  });

  test("a user cannot read another user's profile", async () => {
    const { data, error } = await clientB.from('profiles').select('*').eq('clerk_id', CLERK_TEST_USER_1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("a user cannot update another user's profile", async () => {
    const { data } = await clientB
      .from('profiles')
      .update({ username: 'hijacked' })
      .eq('clerk_id', CLERK_TEST_USER_1)
      .select();
    expect(data).toEqual([]);

    const { data: unchanged } = await clientA
      .from('profiles')
      .select('username')
      .eq('clerk_id', CLERK_TEST_USER_1)
      .single();
    expect(unchanged?.username).toBe('rlstest1');
  });
});
