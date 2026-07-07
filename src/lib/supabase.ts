import { useSession } from '@clerk/clerk-expo';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo } from 'react';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Builds a Supabase client whose every request carries the active Clerk
 * session JWT, so Postgres RLS can key off `auth.jwt() ->> 'sub'`.
 */
export function useSupabase(): SupabaseClient {
  const { session } = useSession();

  return useMemo(
    () =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        accessToken: async () => (await session?.getToken()) ?? null,
      }),
    [session],
  );
}

/**
 * A getter for the current Clerk session JWT. Realtime subscriptions must pass
 * this token *explicitly* to `supabase.realtime.setAuth(token)` before
 * subscribing. The no-argument `setAuth()` resolves the token via the async
 * `accessToken` callback, which races the socket/channel join — a channel can
 * join as `anon` and then silently receive no RLS-gated postgres_changes.
 * Passing the token directly is applied synchronously and is race-free.
 */
export function useClerkToken(): () => Promise<string | null> {
  const { session } = useSession();
  return useCallback(async () => (await session?.getToken()) ?? null, [session]);
}

/** How often to re-apply a fresh token to a Realtime socket (< the ~60s JWT life). */
const REALTIME_AUTH_REFRESH_MS = 40_000;

/**
 * Keeps a Supabase Realtime socket authorized with a *fresh* Clerk JWT for the
 * whole lifetime of a subscription.
 *
 * Clerk session tokens live only ~60 seconds. `setAuth(token)` pins one token
 * onto the socket; once it expires the socket's authorization lapses and every
 * RLS-gated `postgres_changes` **silently stops arriving** — so a match's first
 * question comes through but nothing after the first minute does. This hook
 * re-mints (`skipCache`, so Clerk actually issues a new token rather than
 * returning the cached soon-to-expire one) and re-applies a token on an interval
 * comfortably shorter than the token's life, so long-lived match subscriptions
 * keep receiving changes.
 *
 * Returns `authNow`, which applies a fresh token immediately; subscription
 * effects `await` it before `.subscribe()` so the initial join is also race-free.
 */
export function useRealtimeAuth(supabase: SupabaseClient): () => Promise<void> {
  const { session } = useSession();

  const authNow = useCallback(async () => {
    const token = (await session?.getToken({ skipCache: true })) ?? null;
    await supabase.realtime.setAuth(token);
  }, [session, supabase]);

  useEffect(() => {
    const id = setInterval(() => {
      authNow().catch(() => {});
    }, REALTIME_AUTH_REFRESH_MS);
    return () => clearInterval(id);
  }, [authNow]);

  return authNow;
}
