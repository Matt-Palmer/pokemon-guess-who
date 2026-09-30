-- Local mode: two people, two phones, one room.
--
-- A digital version of the physical board rather than a variant of the async
-- game. Players pick a secret exactly as they do online, then the app gets out
-- of the way: questions and answers happen out loud, so there are no turns, no
-- `match_events` thread, and no in-app guessing. Each player still has their own
-- private board and cross-offs — that part is unchanged, and is why this needs
-- two devices rather than one.
--
-- A match ends when a player reveals *their own* secret, which is how you
-- confirm an opponent's correct spoken guess. Owner-triggered disclosure is the
-- point: a shared "reveal" button either player could press on the *other's*
-- card would let anyone peek at any moment and make the mode trivially
-- cheatable. You can only ever show what you already know.
--
-- Nobody wins on the record. The app never saw a guess, so it cannot know who
-- won, and a self-reported winner is either untrustworthy or needs a two-device
-- handshake. `winner_id` stays null, which `apply_game_end_stats` already treats
-- as "don't touch anyone's record" (00007) — so local games leave profile stats
-- alone by construction, not by a special case.

-- ── Constraints ─────────────────────────────────────────────────────────────
alter table public.matches drop constraint matches_mode_check;
alter table public.matches
  add constraint matches_mode_check check (mode in ('party', 'random', 'local'));

alter table public.matches drop constraint matches_ended_reason_check;
alter table public.matches
  add constraint matches_ended_reason_check
  check (ended_reason in ('guess', 'resign', 'claim_inactive', 'revealed'));

-- ── Creating a local party ──────────────────────────────────────────────────
-- Same code, same lobby, same start — only the mode differs, so the joiner
-- needs no choice of their own: they inherit whatever the host created.
-- Dropped and recreated rather than overloaded: a defaulted parameter alongside
-- the old zero-arg signature would make `create_party()` ambiguous. The body is
-- 00015's (the current definition, with its `ensure_profile()` backstop), not
-- 00002's — only the mode handling is new.
drop function public.create_party();

create or replace function public.create_party(p_mode text default 'party')
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

  if p_mode not in ('party', 'local') then
    raise exception 'invalid_mode' using errcode = 'P0001';
  end if;

  -- Carried over from 00015: `player1_id` is an FK onto `profiles`, and the
  -- client-side insert that creates that row is fire-and-forget. Without this
  -- backstop a fresh account gets a raw FK violation instead of a party.
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
  values (p_mode, 'lobby', new_code, caller_id)
  returning * into result;

  return result;
end;
$$;

-- ── The secret pick, minus the turn loop ────────────────────────────────────
-- Identical to 00016 except that a local match opens into play with `phase` and
-- `current_player` left null: there are no turns to track. The coin flip is
-- skipped for the same reason.
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
  own_secret integer;
  opponent_secret integer;
  completes boolean := false;
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
    own_secret := target.player1_secret;
    opponent_secret := target.player2_secret;
  elsif target.player2_id = caller_id then
    slot := 'player2';
    own_secret := target.player2_secret;
    opponent_secret := target.player1_secret;
  else
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;

  if target.status <> 'active' then
    raise exception 'match_not_active' using errcode = 'P0001';
  end if;

  if not (p_pokemon_id = any(target.board)) then
    raise exception 'not_on_board' using errcode = 'P0001';
  end if;

  if own_secret is not null then
    raise exception 'already_drawn' using errcode = 'P0001';
  end if;

  completes := opponent_secret is not null;
  if completes and target.mode <> 'local' then
    new_first := case when random() < 0.5 then 'player1' else 'player2' end;
  end if;

  update public.matches
  set player1_secret = case when slot = 'player1' then p_pokemon_id else player1_secret end,
      player2_secret = case when slot = 'player2' then p_pokemon_id else player2_secret end,
      first_player = coalesce(new_first, first_player),
      current_player = coalesce(new_first, current_player),
      phase = case when new_first is not null then 'awaiting_question' else phase end,
      last_activity_at = now()
  where id = target.id;
end;
$$;

-- ── Ending a local match ────────────────────────────────────────────────────
-- Reveal your own secret. Ends the match with no winner; `match_result` (00006)
-- gates only on `status = 'completed'` plus membership, so both players can read
-- both secrets the moment this lands — no new read path, and the column grants
-- stay as tight as they were.
create or replace function public.reveal_my_secret(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
  own_secret integer;
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into target from public.matches where id = p_match_id for update;

  if target.id is null then
    raise exception 'match_not_found' using errcode = 'P0001';
  end if;

  if target.player1_id = caller_id then
    own_secret := target.player1_secret;
  elsif target.player2_id = caller_id then
    own_secret := target.player2_secret;
  else
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;

  if target.mode <> 'local' then
    raise exception 'not_a_local_match' using errcode = 'P0001';
  end if;

  if target.status <> 'active' then
    raise exception 'match_not_active' using errcode = 'P0001';
  end if;

  -- Nothing to reveal before you have picked, and revealing must not be a way
  -- to skip the pick phase.
  if own_secret is null then
    raise exception 'no_secret_yet' using errcode = 'P0001';
  end if;

  update public.matches
    set status = 'completed',
        ended_reason = 'revealed',
        ended_at = now(),
        last_activity_at = now()
    where id = target.id;
end;
$$;

-- ── Rules that do not apply in a room ───────────────────────────────────────
-- The inactivity claim is built on whose move it is. A local match has no turns
-- after the pick, so there is no stalled mover to accuse — and "my opponent put
-- their phone down" is a conversation, not a forfeit. It stays available during
-- the pick, where someone can still leave you hanging.
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

  if target.mode = 'local' and target.player1_drawn and target.player2_drawn then
    raise exception 'not_claimable' using errcode = 'P0001';
  end if;

  -- Picks are simultaneous, so during the pick phase the only question is
  -- whether the *opponent* still owes one — both players can owe at once, and
  -- neither slot should be privileged by a week of mutual silence.
  if not (target.player1_drawn and target.player2_drawn) then
    mover := case when slot = 'player1' then 'player2' else 'player1' end;
    if (mover = 'player1' and target.player1_drawn) or (mover = 'player2' and target.player2_drawn) then
      raise exception 'your_move' using errcode = 'P0001';
    end if;
  else
    mover := case
      when target.phase = 'awaiting_answer' then
        case when target.current_player = 'player1' then 'player2' else 'player1' end
      else coalesce(target.current_player, 'player1')
    end;
    if mover = slot then
      raise exception 'your_move' using errcode = 'P0001';
    end if;
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

grant execute on function public.create_party(text) to authenticated;
grant execute on function public.reveal_my_secret(uuid) to authenticated;
revoke execute on function public.create_party(text) from public, anon;
revoke execute on function public.reveal_my_secret(uuid) from public, anon;
