-- Open, simultaneous secret pick — replaces the blind turn-ordered draw.
--
-- The draw used to be blind: the board sat face-down, player 1 picked first,
-- player 2 picked from what was left, and the two secrets were forced distinct.
-- That is now inverted. The board is face-up from the start, both players pick
-- at the same time from all 24 cards, and they may land on the same Pokémon.
--
-- Three checks go, and each takes a consequence with it:
--
--   * `awaiting_player1` (turn order) — neither player waits on the other, so a
--     pick is valid whenever the caller has not yet picked.
--   * `card_taken` (distinctness) — duplicates are allowed by design. Every
--     downstream rule already tolerates them: `guess` compares against the
--     *opponent's* stored secret, so if both players hold Snorlax, guessing
--     Snorlax wins regardless of it also being your own.
--   * the board reshuffle from 00014 — it existed only to stop a rejected
--     `card_taken` tap leaking P1's secret by grid position. With no rejection
--     there is no leak, and a stable board lets players keep their bearings
--     between picking and play.
--
-- `already_drawn` stays a hard invariant: the client confirms a selection before
-- committing, so a pick is final.
--
-- Because picks are simultaneous, "the second pick" is now a race rather than a
-- fixed slot. Setup completes on whichever call finds the opponent's secret
-- already present; the existing `for update` row lock makes that safe, and the
-- first-turn coin flip is random either way.
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

  -- Whoever picks second completes setup: coin-flip the first turn and open
  -- play. `new_first` stays null for the first picker, leaving the turn columns
  -- untouched until both secrets are in.
  if opponent_secret is not null then
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
