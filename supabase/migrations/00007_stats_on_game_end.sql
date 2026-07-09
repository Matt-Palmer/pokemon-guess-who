-- 06 Stats on game-end: authoritative per-player records.
--
-- When a match transitions to status='completed' with a winner, BOTH players'
-- denormalized counters on `profiles` update in the same transaction as the
-- game-ending write (today the `guess` RPC; future resign / inactivity-claim
-- paths fire the same trigger for free). The rule mirrors the pure
-- `applyGameEnd` helper in src/lib/game/stats.ts:
--   * winner: games_played+1, wins+1, current_streak+1, best_streak=max
--   * loser:  games_played+1, losses+1, current_streak resets to 0
-- Win rate is derived (wins ÷ games played) and never stored.
--
-- The counters are authoritative because clients cannot write them: column-level
-- INSERT/UPDATE on `profiles` is narrowed to the identity columns only. And they
-- are recomputable because completed `matches` rows are the history of record —
-- `recompute_my_stats` rebuilds the caller's counters from that history alone.

-- Trigger: fires exactly once per game-end (the status edge into 'completed').
-- SECURITY DEFINER so the profile updates never depend on the caller's own
-- RLS-limited view of profiles (a player can only see their own row).
create or replace function public.apply_game_end_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  loser_id text;
begin
  -- Abandoned matches (and any completion without a winner) don't touch records.
  if new.winner_id is null or new.player1_id is null or new.player2_id is null then
    return new;
  end if;

  loser_id := case when new.winner_id = new.player1_id then new.player2_id else new.player1_id end;

  update public.profiles
    set games_played = games_played + 1,
        wins = wins + 1,
        current_streak = current_streak + 1,
        best_streak = greatest(best_streak, current_streak + 1)
    where clerk_id = new.winner_id;

  update public.profiles
    set games_played = games_played + 1,
        losses = losses + 1,
        current_streak = 0
    where clerk_id = loser_id;

  return new;
end;
$$;

create trigger matches_apply_game_end_stats
  after update on public.matches
  for each row
  when (old.status is distinct from 'completed' and new.status = 'completed')
  execute function public.apply_game_end_stats();

-- Trigger functions can't be called as RPCs, but keep the grants explicit per
-- the 00003 hardening convention.
revoke execute on function public.apply_game_end_stats() from public, anon, authenticated;

-- Make the counters tamper-proof: clients may create/edit their identity
-- columns (RLS already pins the row to their own clerk_id) but the stat
-- counters are writable only by the definer-side trigger and recompute below.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant insert (clerk_id, username, avatar, expo_push_token) on public.profiles to authenticated;
grant update (clerk_id, username, avatar, expo_push_token) on public.profiles to authenticated;

-- Rebuild the caller's counters from the `matches` history of record. Replays
-- completed games in ended_at order applying exactly the trigger's rule, so
-- stats can always be audited/repaired and new derived stats added later.
create or replace function public.recompute_my_stats()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  game record;
  v_games integer := 0;
  v_wins integer := 0;
  v_losses integer := 0;
  v_current integer := 0;
  v_best integer := 0;
  updated public.profiles;
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  for game in
    select winner_id
    from public.matches
    where status = 'completed'
      and winner_id is not null
      and (player1_id = caller_id or player2_id = caller_id)
    order by ended_at asc
  loop
    v_games := v_games + 1;
    if game.winner_id = caller_id then
      v_wins := v_wins + 1;
      v_current := v_current + 1;
      v_best := greatest(v_best, v_current);
    else
      v_losses := v_losses + 1;
      v_current := 0;
    end if;
  end loop;

  update public.profiles
    set games_played = v_games,
        wins = v_wins,
        losses = v_losses,
        current_streak = v_current,
        best_streak = v_best
    where clerk_id = caller_id
    returning * into updated;

  if updated.clerk_id is null then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;

  return updated;
end;
$$;

grant execute on function public.recompute_my_stats() to authenticated;
revoke execute on function public.recompute_my_stats() from public, anon;
