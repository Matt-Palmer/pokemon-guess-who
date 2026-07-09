import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRealtimeAuth, useSupabase } from '@/lib/supabase';

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

/** A row from `my_matches`: the client-visible match columns plus the opponent's public identity. */
export type MyMatchRow = MatchRow & {
  opponent_username: string | null;
  opponent_avatar: string | null;
};

/** One entry in a match's question/answer thread. */
export type MatchEventRow = {
  id: string;
  match_id: string;
  kind: 'question' | 'answer';
  author_id: string;
  author_slot: 'player1' | 'player2';
  body: string;
  created_at: string;
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

export type MatchResult = {
  winnerId: string | null;
  player1Secret: number;
  player2Secret: number;
};

/**
 * The end-of-game reveal: the winner and *both* secrets. Backed by `match_result`,
 * which only returns rows once the match is `completed` and only to its two
 * players — so this stays null mid-game and the column-level secret grants are
 * never loosened. Pass `enabled` (e.g. `status === 'completed'`) so the fetch only
 * fires when a result exists; both winner and loser resolve the same reveal.
 */
export function useMatchResult(matchId: string | undefined, enabled: boolean) {
  const supabase = useSupabase();
  const [result, setResult] = useState<MatchResult | null>(null);

  useEffect(() => {
    if (!matchId || !enabled) return;
    let cancelled = false;

    supabase.rpc('match_result', { p_match_id: matchId }).then(({ data }) => {
      const rows = data as
        | { winner_id: string | null; player1_secret: number; player2_secret: number }[]
        | null;
      if (cancelled || !rows || rows.length === 0) return;
      setResult({
        winnerId: rows[0].winner_id,
        player1Secret: rows[0].player1_secret,
        player2Secret: rows[0].player2_secret,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [matchId, enabled, supabase]);

  return result;
}

const TURN_ERRORS: Record<string, string> = {
  not_your_turn: "It's not your turn.",
  not_awaiting_question: 'A question has already been asked.',
  no_pending_question: "There's no question to answer.",
  empty_question: 'Type a question first.',
  empty_answer: 'Type an answer first.',
  match_not_active: 'This game is no longer active.',
  not_a_player: "You're not a player in this match.",
  not_on_board: "That card isn't on the board.",
};

function friendlyTurnError(message: string, fallback: string): Error {
  return new Error(TURN_ERRORS[message.trim()] ?? fallback);
}

/**
 * Post the current turn's question. The server enforces turn order and phase and
 * returns the appended thread event; the shared phase change arrives via Realtime.
 */
export async function askQuestion(
  supabase: SupabaseClient,
  matchId: string,
  question: string,
): Promise<MatchEventRow> {
  const { data, error } = await supabase.rpc('ask_question', {
    p_match_id: matchId,
    p_question: question,
  });
  if (error) throw friendlyTurnError(error.message, 'Could not post that question.');
  return data as MatchEventRow;
}

/**
 * Answer the pending question. Only the opponent of the asker may answer; on
 * success the turn passes to them.
 */
export async function answerQuestion(
  supabase: SupabaseClient,
  matchId: string,
  answer: string,
): Promise<MatchEventRow> {
  const { data, error } = await supabase.rpc('answer_question', {
    p_match_id: matchId,
    p_answer: answer,
  });
  if (error) throw friendlyTurnError(error.message, 'Could not post that answer.');
  return data as MatchEventRow;
}

export type GuessResult = {
  correct: boolean;
  /** The winner's clerk id on a correct guess; null on a wrong guess. */
  winnerId: string | null;
};

/**
 * Guess the opponent's secret on your turn (offered instead of asking). The
 * server auto-validates and returns the outcome **only to the caller** — a wrong
 * guess never carries the opponent's secret back, so nothing leaks. A correct
 * guess ends the match; a wrong one auto-crosses the missed card on your own
 * board and passes the turn. Neither path writes the shared thread, so the
 * opponent is never shown the guess. The end-of-game reveal comes from
 * {@link useMatchResult} once `status` is `completed`.
 */
export async function guess(
  supabase: SupabaseClient,
  matchId: string,
  pokemonId: number,
): Promise<GuessResult> {
  const { data, error } = await supabase.rpc('guess', {
    p_match_id: matchId,
    p_pokemon_id: pokemonId,
  });
  if (error) throw friendlyTurnError(error.message, 'Could not submit that guess.');
  const row = data as { correct: boolean; winner_id: string | null };
  return { correct: row.correct, winnerId: row.winner_id };
}

/**
 * Cross off (or un-cross) a card on the caller's own board. Private and not
 * turn-gated — it only ever writes the caller's own row.
 */
export async function setBoardMark(
  supabase: SupabaseClient,
  matchId: string,
  pokemonId: number,
  eliminated: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_board_mark', {
    p_match_id: matchId,
    p_pokemon_id: pokemonId,
    p_eliminated: eliminated,
  });
  if (error) throw friendlyTurnError(error.message, 'Could not update that card.');
}

/**
 * Loads a match's question/answer thread and keeps it live.
 *
 * Two update paths, so the thread never gets stuck:
 *  - A realtime `postgres_changes` INSERT stream appends new entries instantly.
 *  - An authoritative refetch runs whenever `revalidateKey` changes. Pass the
 *    match's `last_activity_at` here: every ask/answer bumps it *and* is
 *    delivered to both players via {@link useMatch}'s (reliable) `matches`
 *    subscription — so the thread reloads on the same signal that flips the turn
 *    banner, even if a `match_events` broadcast is ever missed.
 */
export function useMatchEvents(matchId: string | undefined, revalidateKey?: string) {
  const supabase = useSupabase();
  const authNow = useRealtimeAuth(supabase);
  const [events, setEvents] = useState<MatchEventRow[]>([]);

  // Authoritative load: on mount and whenever the match changes (turn advanced).
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;

    supabase
      .from('match_events')
      .select('id, match_id, kind, author_id, author_slot, body, created_at')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        // Replace wholesale — this is the source of truth for the thread.
        setEvents(data as MatchEventRow[]);
      });

    return () => {
      cancelled = true;
    };
  }, [matchId, supabase, revalidateKey]);

  // Fast path: stream inserts in real time (deduped against the refetch).
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    let channel: RealtimeChannel | undefined;

    // Authorize the socket with a fresh Clerk JWT before subscribing, and keep it
    // refreshed (useRealtimeAuth) so events keep arriving past the ~60s token life.
    (async () => {
      await authNow();
      if (cancelled) return;
      channel = supabase
        .channel(`match_events:${matchId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` },
          (payload) => {
            if (cancelled) return;
            const row = payload.new as MatchEventRow;
            setEvents((prev) => (prev.some((e) => e.id === row.id) ? prev : [...prev, row]));
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [matchId, supabase, authNow]);

  return events;
}

/**
 * The caller's own crossed-off cards for a match, plus a `toggle` to flip one.
 *
 * Marks are private: the RLS policy on `board_marks` only ever exposes the
 * owner's rows, so this only reflects — and only receives Realtime changes for —
 * the caller's board.
 *
 * `toggle` updates local state **optimistically** and then writes via the RPC,
 * rolling back only if the write fails. Your own cross-offs must feel instant and
 * must not depend on the Realtime round-trip: if the `board_marks` broadcast were
 * the only thing that flipped the checkmark, a single dropped message would freeze
 * your board. Realtime is kept purely as a secondary sync (e.g. a second device
 * signed in as the same player); incoming events reconcile idempotently.
 */
export function useBoardMarks(matchId: string | undefined) {
  const supabase = useSupabase();
  const authNow = useRealtimeAuth(supabase);
  const [marks, setMarks] = useState<Set<number>>(new Set());
  // Mirror of `marks` for reading the latest value inside `toggle` without
  // making the callback depend on (and churn with) every mark change.
  const marksRef = useRef(marks);
  marksRef.current = marks;

  const toggle = useCallback(
    async (pokemonId: number) => {
      if (!matchId) return;
      const eliminated = !marksRef.current.has(pokemonId);
      // Optimistic: flip immediately so the tap feels instant.
      setMarks((prev) => {
        const next = new Set(prev);
        if (eliminated) next.add(pokemonId);
        else next.delete(pokemonId);
        return next;
      });
      try {
        await setBoardMark(supabase, matchId, pokemonId, eliminated);
      } catch (err) {
        // Roll the optimistic change back on failure.
        setMarks((prev) => {
          const next = new Set(prev);
          if (eliminated) next.delete(pokemonId);
          else next.add(pokemonId);
          return next;
        });
        throw err;
      }
    },
    [matchId, supabase],
  );

  useEffect(() => {
    if (!matchId) {
      setMarks(new Set());
      return;
    }
    let cancelled = false;
    let channel: RealtimeChannel | undefined;

    supabase
      .from('board_marks')
      .select('pokemon_id')
      .eq('match_id', matchId)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setMarks(new Set((data as { pokemon_id: number }[]).map((r) => r.pokemon_id)));
      });

    (async () => {
      await authNow();
      if (cancelled) return;
      channel = supabase
        .channel(`board_marks:${matchId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'board_marks', filter: `match_id=eq.${matchId}` },
          (payload) => {
            if (cancelled) return;
            setMarks((prev) => {
              const next = new Set(prev);
              if (payload.eventType === 'DELETE') {
                next.delete((payload.old as { pokemon_id: number }).pokemon_id);
              } else {
                next.add((payload.new as { pokemon_id: number }).pokemon_id);
              }
              return next;
            });
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [matchId, supabase, authNow]);

  return { marks, toggle };
}

/**
 * Loads a match and keeps it live via Postgres Changes. The table's membership
 * RLS policy means the subscription only ever delivers this match's rows to its
 * two players.
 */
export function useMatch(matchId: string | undefined) {
  const supabase = useSupabase();
  const authNow = useRealtimeAuth(supabase);
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

    // Authenticate the Realtime socket with the Clerk JWT *before* subscribing
    // (race-free join) and keep it refreshed for the life of the match. The
    // no-argument setAuth() would race the channel join — the channel binds its
    // RLS check to the anon role and silently receives no postgres_changes (e.g.
    // the lobby host would never see the opponent join). Just as importantly, the
    // token lives ~60s: without the periodic refresh in useRealtimeAuth the socket
    // would deauthorize mid-match and stop delivering turn/phase updates.
    (async () => {
      await authNow();
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
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [matchId, supabase, authNow]);

  return { match, loading, error };
}

/**
 * The caller's open (lobby/active) games with each opponent's public identity,
 * most recently active first — the home-screen list. Backed by the `my_matches`
 * RPC, since `profiles` rows are self-readable only.
 *
 * Freshness has two layers: `refetch` (call it on screen focus) and a Realtime
 * subscription to `matches` changes. The subscription is unfiltered — the
 * membership RLS policy already scopes delivery to the caller's own matches —
 * so any turn/status/join change to any of the caller's games triggers an
 * authoritative refetch. The refetch keeps the RPC as the single source of
 * truth (a change payload lacks the opponent join and can't signal new rows
 * the socket joined too late to see).
 */
export function useMyMatches() {
  const supabase = useSupabase();
  const authNow = useRealtimeAuth(supabase);
  const [matches, setMatches] = useState<MyMatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('my_matches');
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setError(null);
      setMatches((data as MyMatchRow[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | undefined;

    (async () => {
      await authNow();
      if (cancelled) return;
      channel = supabase
        .channel('my_matches')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
          if (!cancelled) refetch();
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, authNow, refetch]);

  return { matches, loading, error, refetch };
}

/**
 * Cosmetic presence: the set of clerk ids currently online (app open). Joins a
 * single shared presence channel keyed by the caller's own id and mirrors its
 * sync state. Purely informational — nothing about a game's outcome may ever
 * depend on it (the PRD forbids presence-triggered forfeits).
 */
export function useOnlinePlayers(myId: string | undefined) {
  const supabase = useSupabase();
  const authNow = useRealtimeAuth(supabase);
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    let channel: RealtimeChannel | undefined;

    (async () => {
      await authNow();
      if (cancelled) return;
      channel = supabase.channel('online', { config: { presence: { key: myId } } });
      channel
        .on('presence', { event: 'sync' }, () => {
          if (cancelled || !channel) return;
          setOnline(new Set(Object.keys(channel.presenceState())));
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') await channel?.track({ online_at: new Date().toISOString() });
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [myId, supabase, authNow]);

  return online;
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
