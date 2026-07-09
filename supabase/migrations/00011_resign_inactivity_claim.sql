-- 10 Resign & 7-day inactivity claim: graceful exits for dead or unwanted games.
--
-- Two new game-ending RPCs mirroring the reducer's RESIGN / CLAIM_INACTIVE
-- rules. Both end the game the same way a correct guess does — flipping
-- status='completed' with a winner_id — so the stats trigger (00007) and the
-- game-ended push (00009) fire for free on the same status edge.
--
--   * resign             — immediate forfeit: the opponent wins, the resigner
--                          takes the loss. Available to either player at any
--                          point in an active match (draw phase included) and
--                          never turn-gated. Only an explicit resign forfeits;
--                          a disconnect or app-close leaves the row untouched.
--   * claim_inactive_win — when the player to move has been idle for 7+ days,
--                          the waiting player may claim the win. "Player to
--                          move" is draw-order aware and, during
--                          awaiting_answer, the answerer — the same derivation
--                          the reducer (playerToMove) and the push pipeline use.
--
-- `ended_reason` records *how* a game ended ('guess' | 'resign' |
-- 'claim_inactive') so the end screen and the game-ended push can phrase the
-- outcome correctly ("X resigned" reads very differently from "X guessed your
-- secret"). It is client-readable (column-granted) and set only by the
-- SECURITY DEFINER game-ending RPCs — clients still have no UPDATE path into
-- `matches`.

alter table public.matches
  add column ended_reason text
    check (ended_reason in ('guess', 'resign', 'claim_inactive'));

-- Client SELECT on matches is column-explicit (00004), so the new column needs
-- its own grant to be visible (including over Realtime).
grant select (ended_reason) on public.matches to authenticated;

-- Every completion so far could only have come from a correct guess.
update public.matches
  set ended_reason = 'guess'
  where status = 'completed' and winner_id is not null and ended_reason is null;

-- Recreate `guess` so a winning guess records its reason. Identical to 00006
-- otherwise; see that migration for the full privacy rationale.
create or replace function public.guess(p_match_id uuid, p_pokemon_id integer)
returns public.guess_result
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
  slot text;
  opponent_slot text;
  opp_secret integer;
  result public.guess_result;
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
    opponent_slot := 'player2';
  elsif target.player2_id = caller_id then
    slot := 'player2';
    opponent_slot := 'player1';
  else
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;

  if target.status <> 'active' then
    raise exception 'match_not_active' using errcode = 'P0001';
  end if;
  if target.phase is distinct from 'awaiting_question' then
    raise exception 'not_awaiting_question' using errcode = 'P0001';
  end if;
  if target.current_player is distinct from slot then
    raise exception 'not_your_turn' using errcode = 'P0001';
  end if;
  if not (p_pokemon_id = any(target.board)) then
    raise exception 'not_on_board' using errcode = 'P0001';
  end if;

  opp_secret := case
    when opponent_slot = 'player1' then target.player1_secret
    else target.player2_secret
  end;

  if p_pokemon_id = opp_secret then
    update public.matches
      set status = 'completed',
          winner_id = caller_id,
          ended_reason = 'guess',
          ended_at = now(),
          last_activity_at = now()
      where id = target.id;
    result := (true, caller_id, opp_secret);
    return result;
  end if;

  insert into public.board_marks (match_id, owner_id, pokemon_id)
  values (p_match_id, caller_id, p_pokemon_id)
  on conflict (match_id, owner_id, pokemon_id) do nothing;

  update public.matches
    set current_player = opponent_slot,
        last_activity_at = now()
    where id = target.id;

  result := (false, null, null);
  return result;
end;
$$;

-- Resign: immediate forfeit. The only gates are "you are a player" and "the
-- match is active" — resigning is deliberately never turn- or phase-gated.
create or replace function public.resign(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
  opponent_id text;
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into target from public.matches where id = p_match_id for update;
  if target.id is null then
    raise exception 'match_not_found' using errcode = 'P0001';
  end if;

  if target.player1_id = caller_id then
    opponent_id := target.player2_id;
  elsif target.player2_id = caller_id then
    opponent_id := target.player1_id;
  else
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;

  if target.status <> 'active' then
    raise exception 'match_not_active' using errcode = 'P0001';
  end if;

  update public.matches
    set status = 'completed',
        winner_id = opponent_id,
        ended_reason = 'resign',
        ended_at = now(),
        last_activity_at = now()
    where id = target.id;
end;
$$;

-- Claim the win from a 7-day-idle opponent. The player to move is derived
-- exactly like the reducer's playerToMove: draw order first (the drawn flags
-- are generated from the secret columns), then the answerer during
-- awaiting_answer, otherwise the current player. The claim is valid only when
-- that player is the *opponent* of the caller and last_activity_at — bumped by
-- every gameplay RPC, never by the notification cron — is 7+ days old.
create or replace function public.claim_inactive_win(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
  slot text;
  mover text;
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

  mover := case
    when not target.player1_drawn then 'player1'
    when not target.player2_drawn then 'player2'
    when target.phase = 'awaiting_answer' then
      case when target.current_player = 'player1' then 'player2' else 'player1' end
    else coalesce(target.current_player, 'player1')
  end;

  if mover = slot then
    raise exception 'your_move' using errcode = 'P0001';
  end if;

  if target.last_activity_at > now() - interval '7 days' then
    raise exception 'too_early' using errcode = 'P0001';
  end if;

  update public.matches
    set status = 'completed',
        winner_id = caller_id,
        ended_reason = 'claim_inactive',
        ended_at = now(),
        last_activity_at = now()
    where id = target.id;
end;
$$;

grant execute on function public.resign(uuid) to authenticated;
grant execute on function public.claim_inactive_win(uuid) to authenticated;
revoke execute on function public.resign(uuid) from public, anon;
revoke execute on function public.claim_inactive_win(uuid) from public, anon;

-- my_matches mirrors the client-granted match columns exactly, so it gains
-- ended_reason too (always null for the lobby/active rows it returns, but the
-- shapes stay in lockstep). Return-type change requires drop + recreate.
drop function public.my_matches();

create or replace function public.my_matches()
returns table (
  id uuid,
  status text,
  mode text,
  party_code text,
  player1_id text,
  player2_id text,
  player1_drawn boolean,
  player2_drawn boolean,
  board integer[],
  current_player text,
  phase text,
  winner_id text,
  ended_reason text,
  first_player text,
  created_at timestamptz,
  last_activity_at timestamptz,
  ended_at timestamptz,
  opponent_username text,
  opponent_avatar text
)
language sql
security definer
set search_path = public
as $$
  select m.id, m.status, m.mode, m.party_code,
         m.player1_id, m.player2_id, m.player1_drawn, m.player2_drawn,
         m.board, m.current_player, m.phase, m.winner_id, m.ended_reason, m.first_player,
         m.created_at, m.last_activity_at, m.ended_at,
         p.username, p.avatar
  from public.matches m
  left join public.profiles p
    on p.clerk_id = case
      when m.player1_id = (auth.jwt() ->> 'sub') then m.player2_id
      else m.player1_id
    end
  where (auth.jwt() ->> 'sub') in (m.player1_id, m.player2_id)
    and m.status in ('lobby', 'active')
  order by m.last_activity_at desc;
$$;

grant execute on function public.my_matches() to authenticated;
revoke execute on function public.my_matches() from public, anon;
