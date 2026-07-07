-- 04 Turns, questions & answers + cross-off.
--
-- The turn loop runs entirely through SECURITY DEFINER RPCs that mirror the pure
-- reducer's rules and, in one transaction, both append to the persisted Q/A
-- thread (`match_events`) and transition the `matches` row (`phase` /
-- `current_player`). Clients never get INSERT/UPDATE on these tables.
--
--   * ask_question    — current player posts a question; phase -> awaiting_answer.
--   * answer_question — the opponent answers; turn passes, phase -> awaiting_question.
--   * set_board_mark  — private, un-gated cross-off on the caller's own board.

-- ── Q/A thread ──────────────────────────────────────────────────────────────
-- The full running question/answer thread, visible to both players and streamed
-- over Realtime. Append-only from the client's perspective (writes via RPC).
create table public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  kind text not null check (kind in ('question', 'answer')),
  author_id text not null references public.profiles(clerk_id),
  author_slot text not null check (author_slot in ('player1', 'player2')),
  body text not null,
  created_at timestamptz not null default now()
);

create index match_events_match_idx on public.match_events (match_id, created_at);

alter table public.match_events enable row level security;

-- Members of a match can read its thread; this also scopes the Realtime stream.
create policy "match events are readable by their players"
  on public.match_events for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.player1_id = (auth.jwt() ->> 'sub') or m.player2_id = (auth.jwt() ->> 'sub'))
    )
  );

alter publication supabase_realtime add table public.match_events;

-- Writes are RPC-only: no INSERT/UPDATE/DELETE for clients.
revoke insert, update, delete on public.match_events from anon, authenticated;

-- ── Private board marks ─────────────────────────────────────────────────────
-- A player's own crossed-off cards. Strictly private: the RLS policy restricts
-- every row to its owner, so a mark gives the opponent no information and never
-- reaches their device (or Realtime channel).
create table public.board_marks (
  match_id uuid not null references public.matches(id) on delete cascade,
  owner_id text not null references public.profiles(clerk_id),
  pokemon_id integer not null,
  created_at timestamptz not null default now(),
  primary key (match_id, owner_id, pokemon_id)
);

alter table public.board_marks enable row level security;

-- Only the owner can ever see their marks (direct reads *and* Realtime).
create policy "board marks are readable only by their owner"
  on public.board_marks for select
  to authenticated
  using (owner_id = (auth.jwt() ->> 'sub'));

alter publication supabase_realtime add table public.board_marks;
alter table public.board_marks replica identity full;

revoke insert, update, delete on public.board_marks from anon, authenticated;

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Resolve the caller's slot in a match, or raise. Locks the row for the caller.
-- (Inlined per-function below to keep each RPC self-contained; kept identical.)

-- Post the current turn's question. Enforces the reducer's rules: active match,
-- awaiting_question phase, caller is the current player, non-empty body. Appends
-- the question to the thread and flips phase to awaiting_answer (turn unchanged).
create or replace function public.ask_question(p_match_id uuid, p_question text)
returns public.match_events
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
  slot text;
  body text := btrim(p_question);
  ev public.match_events;
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
  if target.phase is distinct from 'awaiting_question' then
    raise exception 'not_awaiting_question' using errcode = 'P0001';
  end if;
  if target.current_player is distinct from slot then
    raise exception 'not_your_turn' using errcode = 'P0001';
  end if;
  if length(body) = 0 then
    raise exception 'empty_question' using errcode = 'P0001';
  end if;

  insert into public.match_events (match_id, kind, author_id, author_slot, body)
  values (p_match_id, 'question', caller_id, slot, body)
  returning * into ev;

  update public.matches
    set phase = 'awaiting_answer', last_activity_at = now()
    where id = p_match_id;

  return ev;
end;
$$;

-- Answer the pending question. Only the opponent of the asker (not the current
-- player) may answer. Appends the answer and passes the turn: the answerer
-- becomes current_player and phase returns to awaiting_question.
create or replace function public.answer_question(p_match_id uuid, p_answer text)
returns public.match_events
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id text := auth.jwt() ->> 'sub';
  target public.matches;
  slot text;
  body text := btrim(p_answer);
  ev public.match_events;
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
  if target.phase is distinct from 'awaiting_answer' then
    raise exception 'no_pending_question' using errcode = 'P0001';
  end if;
  -- The asker (current_player) cannot answer their own question.
  if target.current_player is not distinct from slot then
    raise exception 'not_your_turn' using errcode = 'P0001';
  end if;
  if length(body) = 0 then
    raise exception 'empty_answer' using errcode = 'P0001';
  end if;

  insert into public.match_events (match_id, kind, author_id, author_slot, body)
  values (p_match_id, 'answer', caller_id, slot, body)
  returning * into ev;

  update public.matches
    set current_player = slot, phase = 'awaiting_question', last_activity_at = now()
    where id = p_match_id;

  return ev;
end;
$$;

-- Toggle a private board mark on the caller's own board. Deliberately NOT
-- turn-gated — allowed any time during an active match, on or off turn. Writes
-- only the caller's own row, so it can never affect the opponent's view.
create or replace function public.set_board_mark(
  p_match_id uuid,
  p_pokemon_id integer,
  p_eliminated boolean
)
returns void
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

  select * into target from public.matches where id = p_match_id;
  if target.id is null then
    raise exception 'match_not_found' using errcode = 'P0001';
  end if;
  if target.player1_id <> caller_id and target.player2_id is distinct from caller_id then
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;
  if target.status <> 'active' then
    raise exception 'match_not_active' using errcode = 'P0001';
  end if;
  if not (p_pokemon_id = any(target.board)) then
    raise exception 'not_on_board' using errcode = 'P0001';
  end if;

  if p_eliminated then
    insert into public.board_marks (match_id, owner_id, pokemon_id)
    values (p_match_id, caller_id, p_pokemon_id)
    on conflict (match_id, owner_id, pokemon_id) do nothing;
  else
    delete from public.board_marks
    where match_id = p_match_id and owner_id = caller_id and pokemon_id = p_pokemon_id;
  end if;
end;
$$;

grant execute on function public.ask_question(uuid, text) to authenticated;
grant execute on function public.answer_question(uuid, text) to authenticated;
grant execute on function public.set_board_mark(uuid, integer, boolean) to authenticated;
revoke execute on function public.ask_question(uuid, text) from public, anon;
revoke execute on function public.answer_question(uuid, text) from public, anon;
revoke execute on function public.set_board_mark(uuid, integer, boolean) from public, anon;
