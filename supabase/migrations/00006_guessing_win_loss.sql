-- 05 Guessing & win/loss: the mechanic that ends a game.
--
-- On your turn you may guess instead of asking (ask XOR guess). The `guess` RPC
-- mirrors the pure reducer's GUESS rule and runs SECURITY DEFINER so it can read
-- the opponent's secret to auto-validate:
--   * Correct → the match ends: status='completed', winner_id, ended_at.
--   * Wrong   → the missed card is auto-crossed on the guesser's OWN board (a
--     private board_marks row) and the turn passes to the opponent; phase stays
--     awaiting_question.
--
-- Privacy is the whole point of routing this through an RPC rather than a client
-- write: a guess is *never* appended to the shared `match_events` thread, the RPC
-- result (returned only to the caller) never carries the opponent's secret on a
-- wrong guess, and the auto-cross lands only in the guesser's owner-scoped
-- board_marks. Nothing about what was guessed reaches the opponent.
--
-- Only once the game is over does `match_result` reveal both secrets — to both
-- players — so each side can render the end-of-game card reveal without the
-- column-level secret grants ever being loosened.

-- What the guesser (and only the guesser) learns from a guess. On a wrong guess
-- winner_id / opponent_secret are null so the RPC leaks nothing.
create type public.guess_result as (
  correct boolean,
  winner_id text,
  opponent_secret integer
);

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

  -- Gated exactly like ask_question: active match, the caller's turn, and a
  -- question is expected (you ask XOR guess — never mid-answer).
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
    -- Correct guess wins and ends the match.
    update public.matches
      set status = 'completed',
          winner_id = caller_id,
          ended_at = now(),
          last_activity_at = now()
      where id = target.id;
    result := (true, caller_id, opp_secret);
    return result;
  end if;

  -- Wrong guess: auto-cross the missed card on the guesser's own (private) board
  -- and pass the turn back to the opponent. phase stays 'awaiting_question'.
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

-- Reveal both secrets once the game is over. Readable only by the match's two
-- players and only when status='completed', so mid-game it can never leak a
-- secret — the end-of-game reveal for winner and loser alike flows through here.
create or replace function public.match_result(p_match_id uuid)
returns table (winner_id text, player1_secret integer, player2_secret integer)
language sql
security definer
set search_path = public
as $$
  select m.winner_id, m.player1_secret, m.player2_secret
  from public.matches m
  where m.id = p_match_id
    and m.status = 'completed'
    and (m.player1_id = (auth.jwt() ->> 'sub') or m.player2_id = (auth.jwt() ->> 'sub'));
$$;

grant execute on function public.guess(uuid, integer) to authenticated;
grant execute on function public.match_result(uuid) to authenticated;
revoke execute on function public.guess(uuid, integer) from public, anon;
revoke execute on function public.match_result(uuid) from public, anon;
