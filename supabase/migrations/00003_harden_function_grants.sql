-- Harden the party RPCs per the Supabase security advisors:
--   1. Pin generate_party_code's search_path (guards against search_path
--      injection on a SECURITY-relevant helper).
--   2. Revoke EXECUTE from anon (and the internal helper from authenticated too).
--      Only signed-in users should reach these RPCs; anon is already blocked at
--      runtime by the null-`sub` check, but this removes the surface entirely.
--      Supabase's default privileges grant new public functions to `anon` and
--      `authenticated` by name — not just via PUBLIC — so both must be revoked
--      explicitly for the grant to actually disappear.

alter function public.generate_party_code() set search_path = public;

revoke execute on function public.generate_party_code() from public, anon, authenticated;
revoke execute on function public.create_party() from public, anon;
revoke execute on function public.join_party(text) from public, anon;
revoke execute on function public.start_match(uuid) from public, anon;
revoke execute on function public.match_players(uuid) from public, anon;

-- Re-assert the intended grant (a no-op if already present, but keeps this
-- migration self-contained).
grant execute on function public.create_party() to authenticated;
grant execute on function public.join_party(text) to authenticated;
grant execute on function public.start_match(uuid) to authenticated;
grant execute on function public.match_players(uuid) to authenticated;
