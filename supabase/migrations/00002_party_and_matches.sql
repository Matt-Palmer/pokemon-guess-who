-- Party → shared realtime board: the `matches` table plus the atomic RPCs that
-- create/join a party and start a match with a server-generated shared board.
--
-- All writes flow through SECURITY DEFINER functions that identify the caller
-- via `auth.jwt() ->> 'sub'` (never a client-supplied id), so the client never
-- needs INSERT/UPDATE privileges on `matches`. Clients only get a membership
-- SELECT policy, which also scopes Realtime (Postgres Changes) to the two
-- players in the match.

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'lobby' check (status in ('lobby', 'active', 'completed', 'abandoned')),
  mode text not null check (mode in ('party', 'random')),
  party_code text,
  player1_id text not null references public.profiles(clerk_id),
  player2_id text references public.profiles(clerk_id),
  player1_secret integer,
  player2_secret integer,
  board integer[] not null default '{}',
  current_player text check (current_player in ('player1', 'player2')),
  phase text check (phase in ('awaiting_question', 'awaiting_answer')),
  winner_id text references public.profiles(clerk_id),
  first_player text check (first_player in ('player1', 'player2')),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz
);

-- A party code is only reserved while the party is live (lobby/active). Once a
-- match ends the code is free to be handed out again — "recycled after a game
-- ends" — while the partial unique index guarantees no two live parties collide.
create unique index matches_active_party_code_idx
  on public.matches (party_code)
  where status in ('lobby', 'active') and party_code is not null;

create index matches_player1_idx on public.matches (player1_id);
create index matches_player2_idx on public.matches (player2_id);

alter table public.matches enable row level security;

-- Members of a match can read it. This is the only client-facing policy: it
-- gates both direct reads and the Postgres Changes stream, so a Realtime
-- subscription only ever delivers a match's rows to its two players.
create policy "matches are readable by their players"
  on public.matches for select
  to authenticated
  using (
    player1_id = (auth.jwt() ->> 'sub')
    or player2_id = (auth.jwt() ->> 'sub')
  );

-- Deliver row-level changes over Realtime (respecting the RLS policy above).
alter publication supabase_realtime add table public.matches;
alter table public.matches replica identity full;

-- Generate a 6-char code from an unambiguous alphabet (no 0/O, 1/I/L).
create or replace function public.generate_party_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  code text := '';
  i integer;
begin
  for i in 1..6 loop
    code := code || substr(alphabet, floor(random() * length(alphabet))::integer + 1, 1);
  end loop;
  return code;
end;
$$;

-- Create a private party. The caller becomes player1 (host); the match sits in
-- the lobby with a freshly minted, currently-unique code.
create or replace function public.create_party()
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  new_code text;
  attempts integer := 0;
  result public.matches;
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  loop
    new_code := public.generate_party_code();
    exit when not exists (
      select 1 from public.matches
      where party_code = new_code and status in ('lobby', 'active')
    );
    attempts := attempts + 1;
    if attempts > 20 then
      raise exception 'could not allocate a unique party code';
    end if;
  end loop;

  insert into public.matches (mode, status, party_code, player1_id)
  values ('party', 'lobby', new_code, caller_id)
  returning * into result;

  return result;
end;
$$;

-- Join a party by code. Distinguishes the failure modes the UI must surface:
-- unknown code, already full, or already in progress.
create or replace function public.join_party(p_code text)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Lock the candidate row so two joiners can't both claim the open seat.
  select * into target
  from public.matches
  where upper(party_code) = upper(trim(p_code))
    and status in ('lobby', 'active')
  order by created_at desc
  limit 1
  for update;

  if target.id is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;

  if target.player1_id = caller_id then
    raise exception 'own_party' using errcode = 'P0001';
  end if;

  if target.status <> 'lobby' then
    raise exception 'in_progress' using errcode = 'P0001';
  end if;

  if target.player2_id is not null then
    raise exception 'full' using errcode = 'P0001';
  end if;

  update public.matches
  set player2_id = caller_id,
      last_activity_at = now()
  where id = target.id
  returning * into target;

  return target;
end;
$$;

-- Host starts the match: draws the shared 24-card board server-side (so both
-- players see the identical board) and flips the match to active.
create or replace function public.start_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
  new_board integer[];
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into target
  from public.matches
  where id = p_match_id
  for update;

  if target.id is null then
    raise exception 'match_not_found' using errcode = 'P0001';
  end if;

  if target.player1_id <> caller_id then
    raise exception 'only_host_can_start' using errcode = 'P0001';
  end if;

  if target.status <> 'lobby' then
    raise exception 'already_started' using errcode = 'P0001';
  end if;

  if target.player2_id is null then
    raise exception 'no_opponent' using errcode = 'P0001';
  end if;

  select array_agg(id) into new_board
  from (
    select id from public.pokemon order by random() limit 24
  ) picks;

  update public.matches
  set board = new_board,
      status = 'active',
      last_activity_at = now()
  where id = target.id
  returning * into target;

  return target;
end;
$$;

-- Expose only the public identity (username/avatar) of a match's two players to
-- its members. The `profiles` RLS keeps rows self-readable, so this SECURITY
-- DEFINER function is how a player learns their opponent's name without leaking
-- sensitive columns (push token, stat counters).
create or replace function public.match_players(p_match_id uuid)
returns table (clerk_id text, username text, avatar text)
language sql
security definer
set search_path = public
as $$
  select p.clerk_id, p.username, p.avatar
  from public.matches m
  join public.profiles p on p.clerk_id in (m.player1_id, m.player2_id)
  where m.id = p_match_id
    and (
      m.player1_id = (auth.jwt() ->> 'sub')
      or m.player2_id = (auth.jwt() ->> 'sub')
    );
$$;

grant execute on function public.create_party() to authenticated;
grant execute on function public.join_party(text) to authenticated;
grant execute on function public.start_match(uuid) to authenticated;
grant execute on function public.match_players(uuid) to authenticated;
