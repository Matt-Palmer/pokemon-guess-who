import { useUser } from '@clerk/clerk-expo';
import { useSupabase } from '@/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

export type Profile = {
  clerk_id: string;
  username: string;
  avatar: string | null;
  expo_push_token: string | null;
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

      if (existing) {
        setProfile(existing as Profile);
        setLoading(false);
        return;
      }

      const username = user.username ?? user.primaryEmailAddress?.emailAddress ?? 'Trainer';
      const { data: created, error: insertError } = await supabase
        .from('profiles')
        .insert({ clerk_id: user.id, username })
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
