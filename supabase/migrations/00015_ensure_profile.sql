-- 15 Guarantee a profile row exists for anyone who starts a game.
--
-- `matches.player1_id` / `matches.player2_id` and `matchmaking_queue.user_id`
-- are FKs onto `profiles(clerk_id)`, but that profile row was only ever created
-- client-side, by `useProfile` — an unretried fire-and-forget insert that runs
-- only on the Home and Profile tabs. Two ways that left an account wedged:
--
--   * the insert failed (offline, or a paused project answering every request
--     with "Failed to fetch") and nothing ever retried it; or
--   * it simply had not landed yet when the player tapped a game button.
--
-- Either way the next `create_party` / `join_party` / `find_random_game` blew up
-- with a raw `matches_player1_id_fkey` violation, and kept doing so until a
-- reload happened to retry the insert. Sign-up succeeds independently (Clerk
-- owns it), so the account looked fine while being unable to start any game.
--
-- Every path that writes one of those FK columns is a SECURITY DEFINER RPC, so
-- the guarantee belongs here rather than in the client: each one now ensures its
-- caller's row before inserting. The client insert stays as-is — it is still
-- what supplies the *real* username.
--
-- The Clerk session JWT carries only `sub` — no username or email claim (the
-- Supabase integration's token is deliberately minimal, verified against a
-- freshly minted token) — so the server cannot know a display name. It writes
-- the same 'Trainer' placeholder the client already falls back to, and
-- `useProfile` reconciles it to the real Clerk username on the next load.

create or replace function public.ensure_profile()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- `do nothing` rather than `do update`: this is a backstop, and the row it
  -- would overwrite holds a real username plus the stat counters. It also makes
  -- the call safe under concurrency — two RPCs racing on a fresh account both
  -- succeed, the loser of the insert race taking the no-op branch.
  insert into public.profiles (clerk_id, username)
  values (caller_id, 'Trainer')
  on conflict (clerk_id) do nothing;

  return caller_id;
end;
$$;

-- Internal-only: the RPCs below call it as their (definer) owner. No client ever
-- needs it directly, so it stays off the `authenticated` surface — consistent
-- with 00003's hardening of the function grants.
revoke execute on function public.ensure_profile() from public, anon, authenticated;

-- Unchanged apart from the `ensure_profile()` call after the auth check.
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

  perform public.ensure_profile();

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

-- The joiner writes `player2_id`, so it needs the same guarantee as the host.
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

  -- Before taking the row lock below, so the ensure never runs inside it.
  perform public.ensure_profile();

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

-- Matchmaking FK-violates one step earlier than the party flow: `user_id` on the
-- queue row itself references `profiles`, so a profile-less caller could not even
-- enqueue. Ensuring before the upsert also keeps 00012's locking argument intact
-- — the caller's own queue row is still the first lock it takes.
create or replace function public.find_random_game()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  found_match uuid;
  candidate public.matchmaking_queue;
  new_board integer[];
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  perform public.ensure_profile();

  -- Opportunistic GC of abandoned rows (searcher gone 5+ minutes). SKIP LOCKED
  -- so a row mid-pairing elsewhere is never touched or waited on.
  delete from public.matchmaking_queue
  where user_id in (
    select user_id from public.matchmaking_queue
    where last_seen_at < now() - interval '5 minutes'
    for update skip locked
  );

  -- Enqueue (or heartbeat). Doing this FIRST is load-bearing twice over: the
  -- row lock it takes stops a concurrent caller's scan from claiming us while
  -- we ourselves are scanning, and — because the upsert waits out any in-flight
  -- stamp on our row — the matched_match_id it returns is the authoritative
  -- answer to "was I already paired?". A re-poll keeps the original
  -- enqueued_at — waiting time is the fairness key.
  insert into public.matchmaking_queue as q (user_id)
  values (caller_id)
  on conflict (user_id) do update set last_seen_at = now()
  returning matched_match_id into found_match;

  -- Pick up a pairing made while we waited: someone else created the match and
  -- stamped it on our row. The row's job is done — delete it and hand the
  -- match to the client. (Never scan for a new opponent past this point: we
  -- are already in a game.)
  if found_match is not null then
    delete from public.matchmaking_queue where user_id = caller_id;
    return found_match;
  end if;

  -- Claim the longest-waiting live searcher. SKIP LOCKED means we never wait
  -- and never double-claim.
  select * into candidate
  from public.matchmaking_queue
  where user_id <> caller_id
    and matched_match_id is null
    and last_seen_at > now() - interval '30 seconds'
  order by enqueued_at asc
  limit 1
  for update skip locked;

  if candidate.user_id is null then
    return null;
  end if;

  -- Same server-side board generation as start_match: one shared 24-card board.
  select array_agg(id) into new_board
  from (
    select id from public.pokemon order by random() limit 24
  ) picks;

  -- The waiter earned the player1 seat (they draw first); no lobby — straight
  -- into the blind draw.
  insert into public.matches (mode, status, player1_id, player2_id, board)
  values ('random', 'active', candidate.user_id, caller_id, new_board)
  returning id into found_match;

  update public.matchmaking_queue
  set matched_match_id = found_match
  where user_id = candidate.user_id;

  delete from public.matchmaking_queue where user_id = caller_id;

  return found_match;
end;
$$;
