-- Reshuffle the board when play opens, to close a blind-draw information leak.
--
-- Secrets must be distinct, so `draw_secret` rejects the second player's tap if
-- it lands on player 1's card (`card_taken`). Because the board layout was fixed
-- for the whole game, the grid position of that refusal mapped straight to a
-- Pokémon once the board turned face-up in active play — a player could learn
-- the opponent's secret by position.
--
-- Fix: when the second secret completes the draw, reshuffle the board's order
-- once. Nothing depends on board *order* — secrets and cross-offs (board_marks)
-- are keyed by Pokémon id, `p_pokemon_id = any(board)` is order-independent, and
-- the reveal reads by id — so re-ordering the same 24 ids is safe. Any position a
-- player memorised during the face-down draw no longer maps to a card.
--
-- This is casual-proof: it defeats a player eyeballing positions. It does not
-- defend against inspecting the client-readable `board` array (out of scope).
--
-- Only the player-2 (draw-completing) branch changes; turn order, distinctness,
-- and the coin-flip first turn are all preserved.
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
  new_board integer[];
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

    -- Reshuffle the same 24 ids into a fresh order as play opens, so a position
    -- memorised during the face-down draw no longer maps to a card.
    select array_agg(x order by random()) into new_board
    from unnest(target.board) as x;

    -- Second draw completes setup: coin-flip the first turn and open play.
    new_first := case when random() < 0.5 then 'player1' else 'player2' end;
    update public.matches
      set player2_secret = p_pokemon_id,
          board = new_board,
          first_player = new_first,
          current_player = new_first,
          phase = 'awaiting_question',
          last_activity_at = now()
      where id = target.id;
  end if;
end;
$$;
