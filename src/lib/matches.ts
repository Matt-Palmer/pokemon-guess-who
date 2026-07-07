import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';

import { useSupabase } from '@/lib/supabase';

export type MatchStatus = 'lobby' | 'active' | 'completed' | 'abandoned';

/**
 * A `matches` row as clients see it. The secret columns are deliberately absent:
 * column-level privileges forbid `authenticated` from selecting them, so a
 * player only ever learns their *own* secret via {@link useMySecret}. The
 * non-sensitive `player1_drawn` / `player2_drawn` flags convey draw progress.
 */
export type MatchRow = {
  id: string;
  status: MatchStatus;
  mode: 'party' | 'random';
  party_code: string | null;
  player1_id: string;
  player2_id: string | null;
  player1_drawn: boolean;
  player2_drawn: boolean;
  board: number[];
  current_player: 'player1' | 'player2' | null;
  phase: 'awaiting_question' | 'awaiting_answer' | null;
  winner_id: string | null;
  first_player: 'player1' | 'player2' | null;
  created_at: string;
  last_activity_at: string;
  ended_at: string | null;
};

/** The columns a client is granted on `matches` (secret columns are excluded). */
const MATCH_COLUMNS =
  'id, status, mode, party_code, player1_id, player2_id, board, current_player, phase, ' +
  'winner_id, first_player, created_at, last_activity_at, ended_at, player1_drawn, player2_drawn';

export type MatchPlayer = {
  clerk_id: string;
  username: string;
  avatar: string | null;
};

export type PokemonCard = {
  id: number;
  name: string;
  sprite_url: string;
  types: string[];
  generation: number;
};

/** Host creates a private party; the returned row carries the party code. */
export async function createParty(supabase: SupabaseClient): Promise<MatchRow> {
  const { data, error } = await supabase.rpc('create_party');
  if (error) throw new Error(error.message);
  return data as MatchRow;
}

const JOIN_ERRORS: Record<string, string> = {
  invalid_code: "That code doesn't match an open party.",
  own_party: "You can't join your own party.",
  in_progress: 'That game has already started.',
  full: 'That party is already full.',
};

/**
 * Join a party by code. Translates the RPC's coded exceptions into a message
 * the UI can show directly.
 */
export async function joinParty(supabase: SupabaseClient, code: string): Promise<MatchRow> {
  const { data, error } = await supabase.rpc('join_party', { p_code: code });
  if (error) {
    const friendly = JOIN_ERRORS[error.message.trim()];
    throw new Error(friendly ?? 'Could not join that party.');
  }
  return data as MatchRow;
}

/** Host starts the match; the server draws the shared 24-card board. */
export async function startMatch(supabase: SupabaseClient, matchId: string): Promise<MatchRow> {
  const { data, error } = await supabase.rpc('start_match', { p_match_id: matchId });
  if (error) throw new Error(error.message);
  return data as MatchRow;
}

const DRAW_ERRORS: Record<string, string> = {
  awaiting_player1: 'Waiting for the first player to draw.',
  card_taken: 'That card has already been drawn.',
  already_drawn: "You've already drawn your secret.",
  not_on_board: "That card isn't on the board.",
  match_not_active: 'This game is no longer accepting draws.',
  not_a_player: "You're not a player in this match.",
};

/**
 * Blindly draw a board card as this player's secret. The server enforces turn
 * order and distinctness; nothing is returned so the drawer never receives a
 * row carrying the opponent's secret.
 */
export async function drawSecret(
  supabase: SupabaseClient,
  matchId: string,
  pokemonId: number,
): Promise<void> {
  const { error } = await supabase.rpc('draw_secret', {
    p_match_id: matchId,
    p_pokemon_id: pokemonId,
  });
  if (error) {
    const friendly = DRAW_ERRORS[error.message.trim()];
    throw new Error(friendly ?? 'Could not draw that card.');
  }
}

/**
 * The caller's own secret for a match, or null until they've drawn. Backed by
 * the `my_secret` RPC, which can only ever return the caller's own secret.
 * Exposes `refetch` so the UI can confirm the reveal right after drawing.
 */
export function useMySecret(matchId: string | undefined) {
  const supabase = useSupabase();
  const [secret, setSecret] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    if (!matchId) return;
    const { data } = await supabase.rpc('my_secret', { p_match_id: matchId });
    setSecret((data as number | null) ?? null);
  }, [matchId, supabase]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { secret, refetch };
}

/**
 * Loads a match and keeps it live via Postgres Changes. The table's membership
 * RLS policy means the subscription only ever delivers this match's rows to its
 * two players.
 */
export function useMatch(matchId: string | undefined) {
  const supabase = useSupabase();
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    let channel: RealtimeChannel | undefined;
    setLoading(true);

    supabase
      .from('matches')
      .select(MATCH_COLUMNS)
      .eq('id', matchId)
      .single()
      .then(({ data, error: selectError }) => {
        if (cancelled) return;
        if (selectError) setError(selectError.message);
        else setMatch(data as unknown as MatchRow);
        setLoading(false);
      });

    // Authenticate the Realtime socket with the Clerk JWT *before* subscribing.
    // supabase-js applies Realtime auth asynchronously at client construction,
    // so a channel that joins first binds its RLS check to the anon role and
    // then silently receives no postgres_changes — e.g. the lobby host would
    // never see the opponent join. Awaiting setAuth() forces the token first.
    supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`match:${matchId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
          (payload) => {
            if (!cancelled) setMatch(payload.new as MatchRow);
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [matchId, supabase]);

  return { match, loading, error };
}

/** Reads the public identity (username/avatar) of a match's two players. */
export function useMatchPlayers(matchId: string | undefined) {
  const supabase = useSupabase();
  const [players, setPlayers] = useState<Record<string, MatchPlayer>>({});

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;

    supabase.rpc('match_players', { p_match_id: matchId }).then(({ data }) => {
      if (cancelled || !data) return;
      const byId: Record<string, MatchPlayer> = {};
      for (const p of data as MatchPlayer[]) byId[p.clerk_id] = p;
      setPlayers(byId);
    });

    return () => {
      cancelled = true;
    };
  }, [matchId, supabase]);

  return players;
}

/**
 * Fetches the Pokémon for a board, returned in board order so both devices
 * render the identical layout the server generated.
 */
export function useBoardPokemon(board: number[] | undefined) {
  const supabase = useSupabase();
  const [cards, setCards] = useState<PokemonCard[]>([]);
  const key = (board ?? []).join(',');

  useEffect(() => {
    if (!board || board.length === 0) {
      setCards([]);
      return;
    }
    let cancelled = false;

    supabase
      .from('pokemon')
      .select('id, name, sprite_url, types, generation')
      .in('id', board)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const byId = new Map((data as PokemonCard[]).map((p) => [p.id, p]));
        setCards(board.map((id) => byId.get(id)).filter((p): p is PokemonCard => Boolean(p)));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, supabase]);

  return cards;
}
