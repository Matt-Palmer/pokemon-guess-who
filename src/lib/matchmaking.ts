import { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSupabase } from '@/lib/supabase';

/**
 * One `find_random_game` round trip: enqueues the caller on first call, then
 * acts as a heartbeat/poll — returning the paired match's id as soon as a
 * pairing exists (whether this call created it or a waiting row picked one up),
 * or null while still searching. Idempotent by design: the client calls it to
 * start searching *and* on every poll tick.
 */
export async function findRandomGame(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc('find_random_game');
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/**
 * Leave the queue. Normally returns null; if a pairing landed in the tiny
 * window before the cancel, returns that match's id — the opponent is already
 * committed to a real game, so the caller should proceed into it.
 */
export async function cancelMatchmaking(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc('cancel_matchmaking');
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export type MatchmakingState =
  | { status: 'searching' }
  | { status: 'matched'; matchId: string }
  | { status: 'error'; message: string };

/**
 * Drives a matchmaking search for the life of the component: enqueues on
 * mount, then polls `find_random_game` every ~2s until it returns a match.
 * The interval carries random jitter — the server pairs via non-blocking
 * SKIP LOCKED locks, so two perfectly synchronized pollers would skip each
 * other forever; jitter guarantees the lockstep breaks.
 *
 * `cancel` resolves the race between cancelling and being paired: if a pairing
 * slipped in first it flips state to `matched` (and returns the id) instead of
 * dequeuing, because the opponent is already committed to that game. On plain
 * unmount an unmatched search is dequeued fire-and-forget; if even that races
 * a pairing, the game still surfaces in the home screen's list.
 */
export function useMatchmaking() {
  const supabase = useSupabase();
  const [state, setState] = useState<MatchmakingState>({ status: 'searching' });
  // The poll loop and the unmount cleanup both need the latest outcome without
  // re-running the effect: refs, not state, are the source of truth for them.
  const stoppedRef = useRef(false);
  const matchedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const matchId = await findRandomGame(supabase);
        if (stoppedRef.current) return;
        if (matchId) {
          matchedRef.current = true;
          setState({ status: 'matched', matchId });
          return;
        }
      } catch (err: any) {
        if (stoppedRef.current) return;
        setState({ status: 'error', message: err?.message ?? 'Matchmaking failed.' });
        return;
      }
      timer = setTimeout(tick, 2000 + Math.random() * 800);
    };
    tick();

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
      // Leaving the screen without a match means leaving the queue. Best
      // effort: even if this never lands, the 30s liveness window stops the
      // stale row from being paired.
      if (!matchedRef.current) cancelMatchmaking(supabase).catch(() => {});
    };
  }, [supabase]);

  const cancel = useCallback(async (): Promise<string | null> => {
    stoppedRef.current = true;
    const racedMatchId = await cancelMatchmaking(supabase);
    if (racedMatchId) {
      matchedRef.current = true;
      setState({ status: 'matched', matchId: racedMatchId });
    }
    return racedMatchId;
  }, [supabase]);

  return { state, cancel };
}
