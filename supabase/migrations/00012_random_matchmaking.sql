-- 11 Random matchmaking: pairing with a stranger, first-come-first-served.
--
-- A `matchmaking_queue` row per searching player, and one idempotent SECURITY
-- DEFINER RPC — `find_random_game()` — that the client calls both to enqueue
-- and on every poll tick. Concurrency correctness is the point, and it rests
-- on two locks:
--
--   1. The caller always upserts its OWN queue row first. That row lock is the
--      caller's mutex: while I'm scanning for an opponent, a concurrent
--      caller's candidate scan sees my row locked and skips me — so two
--      players who scan simultaneously can never each grab the other and
--      create two matches.
--   2. The candidate scan itself is FOR UPDATE SKIP LOCKED over the
--      longest-waiting live row, so two callers can never claim the same
--      waiting opponent: the second caller skips the locked row and either
--      finds another candidate or stays enqueued.
--
-- Because neither lock ever *waits* on the other (SKIP LOCKED), the scheme is
-- also deadlock-free. In the worst case two perfectly simultaneous callers
-- both skip each other and both stay enqueued — the next poll tick (client
-- jitter breaks the lockstep) pairs them.
--
-- Pairing creates the match directly in `status='active'` with the shared
-- board already generated (no lobby, no host): the waiter — the player who has
-- been searching longest — becomes player1 and draws first, and both players
-- drop into the standard blind-draw flow. From that row on, a random match is
-- indistinguishable from a party match (`mode='random'`, `party_code` null).
--
-- The winner of the pairing race hands the waiter their match by writing
-- `matched_match_id` on the waiter's queue row; the waiter's next poll picks
-- it up (and deletes the row). The pickup check runs strictly AFTER the
-- caller's own upsert: the upsert blocks on any in-flight stamp and then holds
-- the row lock, so "was I already paired?" and "claim an opponent" are atomic
-- — a caller can never overlook an incoming stamp and pair a second time.
-- Rows carry a `last_seen_at` heartbeat, bumped
-- by every poll: only players seen in the last 30 seconds are candidates, so
-- nobody gets paired against someone who force-quit mid-search, and rows idle
-- for 5+ minutes are garbage-collected opportunistically.

create table public.matchmaking_queue (
  user_id text primary key references public.profiles(clerk_id) on delete cascade,
  enqueued_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  matched_match_id uuid references public.matches(id) on delete cascade
);

-- The pairing scan: longest-waiting unmatched row.
create index matchmaking_queue_waiting_idx
  on public.matchmaking_queue (enqueued_at)
  where matched_match_id is null;

-- RPC-only surface: RLS on with no policies, and no table privileges. Clients
-- never read or write the queue directly — enqueue/poll/cancel all flow
-- through the SECURITY DEFINER functions below.
alter table public.matchmaking_queue enable row level security;
revoke all on public.matchmaking_queue from public, anon, authenticated;

-- Enqueue, heartbeat, pick up a pairing, or pair — one idempotent call.
-- Returns the matched match's id, or null while still searching. The client
-- calls it once to start searching and then on every poll tick.
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

-- Leave the queue. Returns null in the normal case. If a pairing landed in the
-- races' tiny window, returns that match id instead — the opponent is already
-- committed to a real game, so the client should proceed into it rather than
-- silently strand them.
create or replace function public.cancel_matchmaking()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  found_match uuid;
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  delete from public.matchmaking_queue
  where user_id = caller_id
  returning matched_match_id into found_match;

  return found_match;
end;
$$;

grant execute on function public.find_random_game() to authenticated;
grant execute on function public.cancel_matchmaking() to authenticated;
revoke execute on function public.find_random_game() from public, anon;
revoke execute on function public.cancel_matchmaking() from public, anon;
