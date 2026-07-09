-- 08 Async & multiple games: list the caller's open games with their opponent.
--
-- The home screen shows every lobby/active match the caller is in, each with
-- the opponent's public identity. The membership RLS policy already lets a
-- player select their own matches, but `profiles` rows are self-readable only,
-- so learning the opponent's username needs this SECURITY DEFINER helper (the
-- list-shaped sibling of `match_players`).
--
-- The returned columns exactly mirror what clients are granted on `matches` —
-- the secret columns are deliberately absent, same as MATCH_COLUMNS on the
-- client. Whose-turn is derived client-side (summarizeTurn) from these fields.
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
         m.board, m.current_player, m.phase, m.winner_id, m.first_player,
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
