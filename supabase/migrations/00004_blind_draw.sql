-- 03 Blind draw: secret assignment before play begins.
--
-- Each player blindly draws one card from the shared 24-card board as their
-- secret. Player 1 draws first; player 2 then draws from the remaining 23, so
-- the two secrets are always distinct. Writes flow through a SECURITY DEFINER
-- RPC (the client never gets UPDATE on `matches`), and secrets are kept private
-- with column-level privileges: authenticated clients cannot SELECT the secret
-- columns at all — so a player can never read their opponent's secret, whether
-- by direct query or over Realtime (which honours the same column grants). A
-- player reads *only their own* secret through `my_secret()`.

-- Non-sensitive "has drawn" flags so the client can drive the turn-ordered draw
-- UI (whose turn it is, when both are done) without ever seeing a secret value.
alter table public.matches
  add column player1_drawn boolean generated always as (player1_secret is not null) stored,
  add column player2_drawn boolean generated always as (player2_secret is not null) stored;

-- Column-level privacy. A table-level SELECT grant covers every column, so to
-- hide the two secret columns we drop the blanket grant and re-grant SELECT on
-- each remaining (safe) column explicitly. `anon` gets nothing.
revoke select on public.matches from anon, authenticated;
grant select (
  id, status, mode, party_code, player1_id, player2_id, board,
  current_player, phase, winner_id, first_player,
  created_at, last_activity_at, ended_at,
  player1_drawn, player2_drawn
) on public.matches to authenticated;

-- Draw a secret. Identifies the caller's slot from their JWT (never a client
-- argument), enforces turn order (P1 first) and distinctness (P2 can't take
-- P1's card), and — when the second secret completes the draw — flips the match
-- into active play with a coin-flip first turn. Returns void so the drawer never
-- receives a row carrying the opponent's secret.
create or replace function public.draw_secret(p_match_id uuid, p_pokemon_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
  slot text;
  new_first text;
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into target from public.matches where id = p_match_id for update;

  if target.id is null then
    raise exception 'match_not_found' using errcode = 'P0001';
  end if;

  if target.player1_id = caller_id then
    slot := 'player1';
  elsif target.player2_id = caller_id then
    slot := 'player2';
  else
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;

  if target.status <> 'active' then
    raise exception 'match_not_active' using errcode = 'P0001';
  end if;

  if not (p_pokemon_id = any(target.board)) then
    raise exception 'not_on_board' using errcode = 'P0001';
  end if;

  if slot = 'player1' then
    if target.player1_secret is not null then
      raise exception 'already_drawn' using errcode = 'P0001';
    end if;
    update public.matches
      set player1_secret = p_pokemon_id,
          last_activity_at = now()
      where id = target.id;
  else
    if target.player1_secret is null then
      raise exception 'awaiting_player1' using errcode = 'P0001';
    end if;
    if target.player2_secret is not null then
      raise exception 'already_drawn' using errcode = 'P0001';
    end if;
    if p_pokemon_id = target.player1_secret then
      raise exception 'card_taken' using errcode = 'P0001';
    end if;

    -- Second draw completes setup: coin-flip the first turn and open play.
    new_first := case when random() < 0.5 then 'player1' else 'player2' end;
    update public.matches
      set player2_secret = p_pokemon_id,
          first_player = new_first,
          current_player = new_first,
          phase = 'awaiting_question',
          last_activity_at = now()
      where id = target.id;
  end if;
end;
$$;

-- Returns only the caller's own secret (null if they haven't drawn / aren't a
-- player). This is the sole way a client learns a secret, and it can only ever
-- return the caller's own.
create or replace function public.my_secret(p_match_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select case
    when m.player1_id = (auth.jwt() ->> 'sub') then m.player1_secret
    when m.player2_id = (auth.jwt() ->> 'sub') then m.player2_secret
    else null
  end
  from public.matches m
  where m.id = p_match_id;
$$;

grant execute on function public.draw_secret(uuid, integer) to authenticated;
grant execute on function public.my_secret(uuid) to authenticated;
revoke execute on function public.draw_secret(uuid, integer) from public, anon;
revoke execute on function public.my_secret(uuid) from public, anon;
