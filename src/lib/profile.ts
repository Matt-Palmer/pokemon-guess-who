import { useUser } from '@clerk/clerk-expo';
import { useSupabase } from '@/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

export type Profile = {
  clerk_id: string;
  username: string;
  avatar: string | null;
  games_played: number;
  wins: number;
  losses: number;
  current_streak: number;
  best_streak: number;
};

/**
 * Loads the signed-in user's profile row, creating it on first sign-in.
 * RLS guarantees a user can only read/write the row matching their own
 * Clerk `sub`, so this insert can never collide with another user's row.
 *
 * This is no longer the *only* thing that creates the row — the match-creating
 * RPCs call `ensure_profile()` as a backstop (migration 00015), because a failed
 * insert here used to leave an account unable to start any game, with a raw
 * `matches_player1_id_fkey` violation. What this hook still owns is the
 * username: the server has only the caller's `sub` to go on, so it writes a
 * placeholder that the reconcile below replaces with the real Clerk name.
 *
 * `refetch` re-reads the row — call it on screen focus so the stat counters
 * (updated server-side by the game-end trigger) reflect games completed since
 * the profile was first loaded.
 */
export function useProfile() {
  const { user } = useUser();
  const supabase = useSupabase();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrCreateProfile = useCallback(
    async (isCancelled?: () => boolean) => {
      if (!user) return;

      const { data: existing, error: selectError } = await supabase
        .from('profiles')
        .select('*')
        .eq('clerk_id', user.id)
        .maybeSingle();

      if (isCancelled?.()) return;

      if (selectError) {
        setError(selectError.message);
        setLoading(false);
        return;
      }

      // Clerk owns the display name; null when the account has neither a
      // username nor an email, which is the only case we have nothing better
      // than the placeholder.
      const clerkName = user.username ?? user.primaryEmailAddress?.emailAddress ?? null;

      if (existing) {
        setProfile(existing as Profile);
        setLoading(false);

        // Reconcile a name the server could not know. `ensure_profile()` (the
        // RPC-side backstop, migration 00015) can only write 'Trainer' — the
        // Clerk JWT carries just `sub` — so a row it created needs healing here.
        // Nothing renames a profile in-app, so any mismatch means the stored
        // name is stale (a placeholder, or a rename made over in Clerk).
        if (clerkName && existing.username !== clerkName) {
          const { data: renamed } = await supabase
            .from('profiles')
            .update({ username: clerkName })
            .eq('clerk_id', user.id)
            .select()
            .single();
          if (!isCancelled?.() && renamed) setProfile(renamed as Profile);
        }
        return;
      }

      const { data: created, error: insertError } = await supabase
        .from('profiles')
        .insert({ clerk_id: user.id, username: clerkName ?? 'Trainer' })
        .select()
        .single();

      if (isCancelled?.()) return;

      if (insertError) {
        setError(insertError.message);
      } else {
        setProfile(created as Profile);
      }
      setLoading(false);
    },
    [user, supabase],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadOrCreateProfile(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadOrCreateProfile]);

  // Silent refresh: no loading flip, so a focus refetch never flashes a spinner
  // over already-rendered stats.
  const refetch = useCallback(() => {
    loadOrCreateProfile();
  }, [loadOrCreateProfile]);

  return { profile, loading, error, refetch };
}
